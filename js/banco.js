// Camada de dados. Duas implementações com a mesma interface:
//   - Supabase (nuvem): login, dados compartilhados entre celular e notebook
//   - Demonstração: tudo guardado no próprio aparelho (IndexedDB)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const TABELAS = ["produtos", "variacoes", "lotes", "clientes", "vendas", "itens_venda",
  "despesas", "sonhos", "aportes", "relampagos"];

export const CONFIG_PADRAO = {
  nome_loja: "Minha Loja", margem_minima_pct: 30, taxa_cartao_pct: 4, considerar_taxa_cartao: true,
  escada_promocao: "35:10,50:20,65:30", limite_mei_anual: 81000, instagram_arroba: null, whatsapp_loja: null,
  cadastro_completo: false, responsavel_nome: null, responsavel_whatsapp: null, responsavel_email: null,
  responsavel_cargo: null, loja_razao_social: null, loja_cnpj: null, loja_segmento: null, loja_canais: null,
  cep: null, endereco: null, numero: null, bairro: null, cidade: null, uf: null, logo: null,
  cor_primaria: null, cor_secundaria: null, meta_mensal: 0,
  capital_inicial: 0, salario_desejado: 0, pct_reinvestir: 30, pct_reserva: 10, pct_salario: 50, pct_sonhos: 10,
  relampago_horas: 3, relampago_margem_min: 15, relampago_descontos: "20,30,50", ultimo_mes_dividido: null,
};

export const novoId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// =====================================================================  SUPABASE
export class BancoSupabase {
  constructor(createClient) {
    this.modo = "nuvem";
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  }
  async usuario() { const { data } = await this.sb.auth.getSession(); return data.session?.user ?? null; }
  async entrar(email, senha) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(traduzirErro(error.message));
  }
  async criarConta(email, senha) {
    const { data, error } = await this.sb.auth.signUp({ email, password: senha });
    if (error) throw new Error(traduzirErro(error.message));
    return !!data.session; // false = precisa confirmar o e-mail
  }
  async sair() { await this.sb.auth.signOut(); }

  async _todos(tabela) {  // o Supabase devolve no máximo 1000 linhas por vez
    const linhas = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await this.sb.from(tabela).select("*").range(de, de + 999);
      if (error) throw new Error(error.message);
      linhas.push(...data);
      if (data.length < 1000) return linhas;
    }
  }
  async carregar() {
    const [cfg, ...resto] = await Promise.all([
      this.sb.from("config").select("*").maybeSingle(), ...TABELAS.map((t) => this._todos(t))]);
    let config = cfg.data;
    if (!config) {
      const { data, error } = await this.sb.from("config").insert({}).select().single();
      if (error) throw new Error(error.message);
      config = data;
    }
    const e = { config };
    TABELAS.forEach((t, i) => (e[t] = resto[i]));
    return e;
  }
  async inserir(tabela, linhas) {
    if (!linhas.length) return;
    const { error } = await this.sb.from(tabela).insert(linhas);
    if (error) throw new Error(traduzirErro(error.message));
  }
  async atualizar(tabela, id, campos) {
    const { error } = await this.sb.from(tabela).update(campos).eq("id", id);
    if (error) throw new Error(error.message);
  }
  async remover(tabela, id) {
    const { error } = await this.sb.from(tabela).delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
  async salvarConfig(campos) {
    const { data, error } = await this.sb.from("config").update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq("owner_id", (await this.usuario()).id).select().single();
    if (error) throw new Error(error.message);
    return data;
  }
  async registrarVenda({ id, forma, clienteId, desconto, itens }) {
    const { data, error } = await this.sb.rpc("registrar_venda", {
      p_id: id, p_forma: forma, p_cliente: clienteId, p_desconto: desconto, p_itens: itens });
    if (error) throw new Error(error.message);
    return data;
  }
  async enviarFoto(prefixo, blob) {
    const ext = blob.type === "image/png" ? "png" : "jpg";
    const caminho = `${(await this.usuario()).id}/${prefixo}_${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from("fotos").upload(caminho, blob, { contentType: blob.type || "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);
    return caminho;
  }
  async apagarFoto(caminho) { if (caminho) await this.sb.storage.from("fotos").remove([caminho]); }
  urlFoto(caminho) { return caminho ? this.sb.storage.from("fotos").getPublicUrl(caminho).data.publicUrl : null; }
}

function traduzirErro(m) {
  const t = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Confirme o e-mail (veja sua caixa de entrada) e tente de novo.",
    "User already registered": "Esse e-mail já tem conta. Use Entrar.",
    "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
  };
  for (const [k, v] of Object.entries(t)) if (m.includes(k)) return v;
  if (m.includes("duplicate key")) return "Já existe um registro com esse código.";
  return m;
}

// =====================================================================  DEMONSTRAÇÃO (no aparelho)
class BancoLocal {
  constructor() { this.modo = "demo"; this.fotos = new Map(); }
  async _db() {
    if (this.db) return this.db;
    this.db = await new Promise((ok, erro) => {
      const r = indexedDB.open("loja-demo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
    });
    return this.db;
  }
  async _ler(chave) {
    const db = await this._db();
    return new Promise((ok) => { const r = db.transaction("kv").objectStore("kv").get(chave); r.onsuccess = () => ok(r.result); r.onerror = () => ok(undefined); });
  }
  async _gravar(chave, valor) {
    const db = await this._db();
    return new Promise((ok, erro) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(valor, chave); tx.oncomplete = ok; tx.onerror = () => erro(tx.error); });
  }
  async usuario() { return { id: "demo", email: "demonstração" }; }
  async entrar() {} async criarConta() { return true; } async sair() {}
  async carregar() {
    const e = { config: { ...CONFIG_PADRAO, ...((await this._ler("config")) || {}) } };
    for (const t of TABELAS) e[t] = (await this._ler(t)) || [];
    this.e = e;
    return structuredClone(e);
  }
  async _salvar(t) { await this._gravar(t, this.e[t]); }
  async inserir(tabela, linhas) {
    for (const l of linhas) {
      if (tabela === "variacoes" && this.e.variacoes.some((v) => v.codigo === l.codigo)) throw new Error("Já existe um registro com esse código.");
      this.e[tabela].push({ ...l });
    }
    await this._salvar(tabela);
  }
  async atualizar(tabela, id, campos) {
    const l = this.e[tabela].find((x) => x.id === id); if (l) Object.assign(l, campos);
    await this._salvar(tabela);
  }
  async remover(tabela, id) { this.e[tabela] = this.e[tabela].filter((x) => x.id !== id); await this._salvar(tabela); }
  async salvarConfig(campos) { Object.assign(this.e.config, campos); await this._gravar("config", this.e.config); return { ...this.e.config }; }
  async registrarVenda({ id, forma, clienteId, desconto, itens }) {
    // mesma regra da função registrar_venda do Supabase (lotes mais antigos primeiro, tudo ou nada)
    const lotes = structuredClone(this.e.lotes), novos = [];
    let total = 0, custo = 0;
    for (const it of itens) {
      let falta = it.quantidade;
      const ls = lotes.filter((l) => l.variacao_id === it.variacao_id && l.quantidade_atual > 0)
        .sort((a, b) => a.data_entrada.localeCompare(b.data_entrada) || a.id.localeCompare(b.id));
      for (const l of ls) {
        if (!falta) break;
        const q = Math.min(falta, l.quantidade_atual), p = l.preco_promocional ?? l.preco_venda;
        l.quantidade_atual -= q; falta -= q; total += q * p; custo += q * l.custo_unit;
        novos.push({ id: novoId(), venda_id: id, variacao_id: l.variacao_id, lote_id: l.id, quantidade: q,
          preco_unit: p, custo_unit: l.custo_unit, em_promocao: l.preco_promocional != null });
      }
      if (falta > 0) throw new Error(`Estoque insuficiente para a peça ${it.codigo}`);
    }
    total = Math.round((total - (desconto || 0)) * 100) / 100;
    const taxa = ["credito", "debito"].includes(forma) ? Math.round(total * this.e.config.taxa_cartao_pct) / 100 : 0;
    this.e.lotes = lotes;
    this.e.vendas.push({ id, data: new Date().toISOString(), cliente_id: clienteId, forma_pagamento: forma,
      total, custo_total: Math.round(custo * 100) / 100, taxa_pagamento: taxa });
    this.e.itens_venda.push(...novos);
    await Promise.all(["lotes", "vendas", "itens_venda"].map((t) => this._salvar(t)));
    return { venda_id: id, total, custo: Math.round(custo * 100) / 100, taxa_maquininha: taxa };
  }
  async enviarFoto(prefixo, blob) {
    const caminho = `demo/${prefixo}_${Date.now()}.${blob.type === "image/png" ? "png" : "jpg"}`;
    await this._gravar("foto:" + caminho, blob);
    this.fotos.set(caminho, URL.createObjectURL(blob));
    return caminho;
  }
  async apagarFoto() {}
  async prepararFotos(caminhos) {  // cria os links das fotos guardadas no aparelho
    for (const c of caminhos) if (c && !this.fotos.has(c)) {
      const b = await this._ler("foto:" + c); if (b) this.fotos.set(c, URL.createObjectURL(b));
    }
  }
  urlFoto(caminho) { return caminho ? this.fotos.get(caminho) || null : null; }
}

export async function criarBanco() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    return new BancoSupabase(createClient);
  }
  return new BancoLocal();
}

