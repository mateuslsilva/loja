// "Servidor dentro da página": mesmas operações da API Python, agora rodando no aparelho
// e gravando no Supabase (ou no próprio aparelho, no modo demonstração).
import { novoId } from "./banco.js";
import * as R from "./regras.js";
import { gerarFlyer } from "./flyer.js";

const FORMAS = ["pix", "dinheiro", "debito", "credito", "fiado"];
let banco, E;  // E = estado em memória (todas as tabelas)

export async function iniciarServico(b) {
  banco = b;
  E = await banco.carregar();
  if (banco.prepararFotos) await banco.prepararFotos(E.produtos.map((p) => p.foto));
  await rodarRobo();  // ao abrir o app, já atualiza as promoções do dia
}

class ErroApp extends Error {}
const falhar = (m) => { throw new ErroApp(m); };

// ---------------------------------------------------------------- consultas auxiliares
const variacoesDe = (pid) => E.variacoes.filter((v) => v.produto_id === pid);
const lotesDe = (vid) => E.lotes.filter((l) => l.variacao_id === vid)
  .sort((a, b) => a.data_entrada.localeCompare(b.data_entrada) || a.id.localeCompare(b.id));
const qtdVariacao = (vid) => lotesDe(vid).reduce((s, l) => s + l.quantidade_atual, 0);
const produto = (id) => E.produtos.find((p) => p.id === id) || falhar("Produto não encontrado");
const codigoBase = (p) => `${p.categoria}-${String(p.sequencial).padStart(4, "0")}`;

function loteJson(l) {
  const atual = R.precoAtual(l);
  return { lote_id: l.id, data_entrada: l.data_entrada, dias_em_loja: R.diasEntre(l.data_entrada),
    quantidade: l.quantidade_atual, custo: l.custo_unit, preco_venda: l.preco_venda,
    preco_promocional: l.preco_promocional, desconto_pct: l.desconto_pct, promo_no_piso: l.promo_no_piso,
    preco_atual: atual, lucro_unit: Math.round((atual - l.custo_unit) * 100) / 100, margem_pct: R.margemPct(atual, l.custo_unit) };
}
function variacaoJson(v) {
  const p = E.produtos.find((x) => x.id === v.produto_id);
  return { variacao_id: v.id, codigo: v.codigo, codigo_barras: v.codigo_barras, produto: p.nome,
    cor: v.cor, tamanho: v.tamanho, quantidade: qtdVariacao(v.id),
    lotes: lotesDe(v.id).filter((l) => l.quantidade_atual > 0).map(loteJson) };
}
function produtoJson(p) {
  const vs = variacoesDe(p.id).sort((a, b) => a.cor.localeCompare(b.cor) || R.chaveTamanho(a.tamanho) - R.chaveTamanho(b.tamanho));
  return { produto_id: p.id, codigo: codigoBase(p), nome: p.nome, foto: banco.urlFoto(p.foto),
    categoria: R.CATEGORIAS[p.categoria] || p.categoria,
    quantidade_total: vs.reduce((s, v) => s + qtdVariacao(v.id), 0), variacoes: vs.map(variacaoJson) };
}
function acharVariacao(codigo) {
  const c = String(codigo).trim().toUpperCase();
  return E.variacoes.find((v) => v.codigo === c || v.codigo_barras === c) || falhar(`Peça não encontrada: ${codigo}`);
}

// ---------------------------------------------------------------- cadastro
function montarVariacao(p, cor, tamanho, novasDoProduto) {
  const tam = R.normalizaTamanho(tamanho);
  let sigla = R.siglaCor(cor);
  const usadas = new Map([...variacoesDe(p.id), ...novasDoProduto].map((v) => [v.cor_sigla, v.cor.toLowerCase()]));
  const base = sigla; let n = 1;
  while (usadas.has(sigla) && usadas.get(sigla) !== R.titulo(cor).toLowerCase()) sigla = base.slice(0, 2) + n++;
  const codigo = `${codigoBase(p)}-${sigla}-${tam}`;
  if ([...E.variacoes, ...novasDoProduto].some((v) => v.codigo === codigo)) falhar(`Já existe a variação ${codigo}. Use Repor estoque.`);
  const numero = Math.max(0, ...E.variacoes.map((v) => v.numero), ...novasDoProduto.map((v) => v.numero)) + 1;
  return { id: novoId(), produto_id: p.id, cor: R.titulo(cor), cor_sigla: sigla, tamanho: tam, numero, codigo, codigo_barras: R.ean13(numero) };
}

function montarLote(v, qtd, custo, preco, data) {
  if (!(custo > 0)) falhar("Informe o valor pago (custo).");
  if (!(preco > custo)) falhar(`Preço de venda (${R.brl(preco)}) precisa ser maior que o custo (${R.brl(custo)}).`);
  const l = { id: novoId(), variacao_id: v.id, data_entrada: data || R.hojeISO(), quantidade_inicial: qtd,
    quantidade_atual: qtd, custo_unit: custo, preco_venda: preco, preco_promocional: null, desconto_pct: 0,
    promo_no_piso: false, promo_desde: null };
  const c = R.calcularPromo(l, E.config);  // peça com data antiga já entra com o preço certo
  Object.assign(l, { preco_promocional: c.preco, desconto_pct: c.desconto_pct, promo_no_piso: c.no_piso,
    promo_desde: c.preco ? R.hojeISO() : null });
  return l;
}

async function cadastrarProduto(d) {
  if (!d.nome?.trim()) falhar("Informe o nome da peça.");
  const cat = R.siglaCategoria(d.categoria);
  const seq = Math.max(0, ...E.produtos.filter((p) => p.categoria === cat).map((p) => p.sequencial)) + 1;
  const p = { id: novoId(), categoria: cat, sequencial: seq, nome: d.nome.trim(), foto: null, criado_em: new Date().toISOString() };
  const vs = [], ls = [];
  for (const g of d.grade) {
    const v = montarVariacao(p, g.cor, g.tamanho, vs); vs.push(v);
    if (g.quantidade > 0) ls.push(montarLote(v, g.quantidade, d.custo, d.preco_venda, d.data_entrada));
  }
  await banco.inserir("produtos", [p]); await banco.inserir("variacoes", vs); await banco.inserir("lotes", ls);
  E.produtos.push(p); E.variacoes.push(...vs); E.lotes.push(...ls);
  return { ...produtoJson(p), lucro_por_peca: Math.round((d.preco_venda - d.custo) * 100) / 100,
    margem_pct: R.margemPct(d.preco_venda, d.custo) };
}

async function entradaEstoque(d) {
  const v = acharVariacao(d.codigo), ls = lotesDe(v.id);
  const preco = d.preco_venda || ls.at(-1)?.preco_venda || falhar("Informe o preço de venda.");
  const l = montarLote(v, d.quantidade, d.custo, preco, d.data_entrada);
  await banco.inserir("lotes", [l]); E.lotes.push(l);
  return variacaoJson(v);
}

// ---------------------------------------------------------------- vendas
async function registrarVenda(d) {
  if (!FORMAS.includes(d.forma_pagamento)) falhar("Forma de pagamento inválida.");
  if (!d.itens?.length) falhar("Adicione pelo menos uma peça.");
  const itens = d.itens.map((it) => {
    const v = acharVariacao(it.codigo);
    if (qtdVariacao(v.id) < it.quantidade) falhar(`${v.codigo}: só tem ${qtdVariacao(v.id)} em estoque.`);
    return { variacao_id: v.id, quantidade: it.quantidade, codigo: v.codigo };
  });
  const id = novoId();
  const r = await banco.registrarVenda({ id, forma: d.forma_pagamento, clienteId: d.cliente_id || null,
    desconto: d.desconto_extra || 0, itens });
  E = await banco.carregar();  // recarrega estoque e vendas como ficaram no banco
  if (banco.prepararFotos) await banco.prepararFotos(E.produtos.map((p) => p.foto));
  const lucro = Math.round((r.total - r.custo - r.taxa_maquininha) * 100) / 100;
  return { ...r, lucro, alerta: lucro < 0 ? "Atenção: essa venda deu prejuízo." : null };
}

function vendasDoDia(dia = R.hojeISO()) {
  const vs = E.vendas.filter((v) => R.hojeISO(new Date(v.data)) === dia);
  const porForma = {};
  vs.forEach((v) => (porForma[v.forma_pagamento] = Math.round(((porForma[v.forma_pagamento] || 0) + v.total) * 100) / 100));
  const lucro = vs.reduce((s, v) => s + v.total - v.custo_total - v.taxa_pagamento, 0);
  return { dia, quantidade_vendas: vs.length, total: Math.round(vs.reduce((s, v) => s + v.total, 0) * 100) / 100,
    lucro: Math.round(lucro * 100) / 100, por_forma_pagamento: porForma };
}

// ---------------------------------------------------------------- promoções
export async function rodarRobo() {
  const res = { novas: [], no_piso: [], encerradas: 0, lotes_avaliados: 0 };
  for (const l of E.lotes.filter((x) => x.quantidade_atual > 0)) {
    res.lotes_avaliados++;
    const c = R.calcularPromo(l, E.config);
    if (c.preco === l.preco_promocional && c.no_piso === l.promo_no_piso) continue;
    const v = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === v.produto_id);
    const info = { lote_id: l.id, produto_id: p.id, codigo: v.codigo, produto: p.nome, cor: v.cor, tamanho: v.tamanho,
      quantidade: l.quantidade_atual, dias_em_loja: c.dias, preco_cheio: l.preco_venda, preco_promocional: c.preco,
      desconto_pct: c.desconto_pct, custo: l.custo_unit, piso: c.piso };
    if (c.preco == null && l.preco_promocional != null) res.encerradas++;
    const campos = { preco_promocional: c.preco, desconto_pct: c.preco ? c.desconto_pct : 0, promo_no_piso: c.no_piso,
      promo_desde: c.preco ? (l.promo_desde || R.hojeISO()) : null };
    if (c.preco !== l.preco_promocional) (c.no_piso ? res.no_piso : (c.preco ? res.novas : [])).push(info);
    await banco.atualizar("lotes", l.id, campos);
    Object.assign(l, campos);
  }
  return res;
}

function pecasEmPromocao() {
  return E.lotes.filter((l) => l.quantidade_atual > 0 && l.preco_promocional != null).map((l) => {
    const v = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === v.produto_id);
    return { produto_id: p.id, foto: banco.urlFoto(p.foto), codigo: v.codigo, produto: p.nome, cor: v.cor, tamanho: v.tamanho,
      quantidade: l.quantidade_atual, dias_em_loja: R.diasEntre(l.data_entrada), preco_cheio: l.preco_venda,
      preco_promocional: l.preco_promocional, desconto_pct: l.desconto_pct, no_limite_da_margem: l.promo_no_piso,
      lucro_unit: Math.round((l.preco_promocional - l.custo_unit) * 100) / 100 };
  }).sort((a, b) => b.dias_em_loja - a.dias_em_loja);
}

function divulgacao() {
  const itens = pecasEmPromocao(), t = R.textoDivulgacao(itens, E.config.nome_loja);
  const tams = new Set(itens.map((i) => i.tamanho));
  const compraram = new Set(E.itens_venda.filter((it) => tams.has(E.variacoes.find((v) => v.id === it.variacao_id)?.tamanho))
    .map((it) => E.vendas.find((v) => v.id === it.venda_id)?.cliente_id).filter(Boolean));
  const clientes = E.clientes.filter((c) => compraram.has(c.id) && c.whatsapp)
    .map((c) => ({ nome: c.nome, whatsapp: c.whatsapp, mensagem: t.whatsapp.replace("{nome}", c.nome.split(" ")[0]) }));
  return { instagram: t.instagram, whatsapp_modelo: t.whatsapp, clientes_para_avisar: clientes };
}

// ---------------------------------------------------------------- painel
function painel() {
  const cfg = E.config, ls = E.lotes.filter((l) => l.quantidade_atual > 0);
  const escada = R.lerEscada(cfg.escada_promocao), diasAlerta = escada.length ? escada[0][0] : 35;
  const parados = ls.filter((l) => R.diasEntre(l.data_entrada) >= diasAlerta);
  const soma = (arr, f) => Math.round(arr.reduce((s, x) => s + f(x), 0) * 100) / 100;
  const ano = new Date().getFullYear();
  const faturado = soma(E.vendas.filter((v) => new Date(v.data).getFullYear() === ano), (v) => v.total);
  const projecao = faturado / (new Date().getMonth() + 1) * 12, uso = faturado / cfg.limite_mei_anual * 100;
  let alerta = null;
  if (uso >= 100) alerta = "Limite do MEI ultrapassado! Procure um contador.";
  else if (uso >= 80 || projecao > cfg.limite_mei_anual) alerta = "Atenção: no ritmo atual você pode passar do limite do MEI este ano.";
  return { pecas_em_estoque: ls.reduce((s, l) => s + l.quantidade_atual, 0),
    valor_estoque_custo: soma(ls, (l) => l.quantidade_atual * l.custo_unit),
    valor_estoque_venda: soma(ls, (l) => l.quantidade_atual * R.precoAtual(l)),
    pecas_paradas: parados.reduce((s, l) => s + l.quantidade_atual, 0),
    dinheiro_parado: soma(parados, (l) => l.quantidade_atual * l.custo_unit), dias_para_considerar_parada: diasAlerta,
    pecas_em_promocao: ls.filter((l) => l.preco_promocional != null).reduce((s, l) => s + l.quantidade_atual, 0),
    mei: { ano, faturado, limite: cfg.limite_mei_anual, uso_pct: Math.round(uso * 10) / 10,
      projecao_ano: Math.round(projecao * 100) / 100, alerta } };
}

// ---------------------------------------------------------------- fotos e flyers
async function reduzirFoto(arquivo) {
  const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.88));
}

async function enviarFoto(pid, arquivo) {
  const p = produto(pid);
  let blob; try { blob = await reduzirFoto(arquivo); } catch { falhar("Arquivo não é uma imagem válida"); }
  const caminho = await banco.enviarFoto(pid, blob);
  const antiga = p.foto;
  await banco.atualizar("produtos", pid, { foto: caminho }); p.foto = caminho;
  banco.apagarFoto(antiga).catch(() => {});
  return { foto: banco.urlFoto(caminho) };
}

function dadosFlyer(p, tipo) {
  let ls = variacoesDe(p.id).flatMap((v) => lotesDe(v.id).filter((l) => l.quantidade_atual > 0).map((l) => [v, l]));
  if (tipo === "promo") ls = ls.filter(([, l]) => l.preco_promocional != null);
  if (!ls.length) falhar(tipo === "promo" ? "Esse produto não tem peças em promoção." : "Esse produto está sem estoque.");
  let preco_por, preco_de = null, desconto = 0;
  if (tipo === "promo") {
    const [, l0] = ls.reduce((a, b) => (b[1].preco_promocional < a[1].preco_promocional ? b : a));
    preco_por = l0.preco_promocional; preco_de = l0.preco_venda; desconto = Math.round((1 - preco_por / preco_de) * 100);
  } else preco_por = Math.min(...ls.map(([, l]) => R.precoAtual(l)));
  return { produto_id: p.id, nome: p.nome, tipo, preco_de, preco_por, desconto_pct: desconto,
    tamanhos: [...new Set(ls.map(([v]) => v.tamanho))].sort((a, b) => R.chaveTamanho(a) - R.chaveTamanho(b)),
    cores: [...new Set(ls.map(([v]) => v.cor))].sort(), foto: banco.urlFoto(p.foto),
    loja: E.config.nome_loja, arroba: E.config.instagram_arroba, whatsapp: E.config.whatsapp_loja };
}

async function flyer(pid, { tipo = "promo", formatos = ["feed", "story"] }) {
  const d = dadosFlyer(produto(pid), tipo), leg = R.legenda(d);
  const out = [];
  for (const f of formatos) out.push({ formato: f, tipo, url: URL.createObjectURL(await gerarFlyer(d, f)), legenda: leg });
  return out;
}

// ---------------------------------------------------------------- config / clientes
const CAMPOS_CONFIG = ["nome_loja", "margem_minima_pct", "taxa_cartao_pct", "considerar_taxa_cartao",
  "escada_promocao", "limite_mei_anual", "instagram_arroba", "whatsapp_loja"];
const verConfig = () => ({ ...Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, E.config[k]])), modo: banco.modo });

async function salvarConfig(d) {
  const novos = {};
  for (const k of CAMPOS_CONFIG) if (d[k] !== undefined && d[k] !== null && !(typeof d[k] === "number" && isNaN(d[k]))) novos[k] = d[k];
  if ("instagram_arroba" in novos) novos.instagram_arroba = String(novos.instagram_arroba).trim().replace(/^@/, "") || null;
  if ("whatsapp_loja" in novos) novos.whatsapp_loja = String(novos.whatsapp_loja).trim() || null;
  if (novos.escada_promocao !== undefined && !R.lerEscada(novos.escada_promocao).length) falhar("Escada inválida. Use o formato 35:10,50:20,65:30");
  E.config = { ...E.config, ...(await banco.salvarConfig(novos)) };
  await rodarRobo();
  return verConfig();
}

async function novoCliente(d) {
  if (!d.nome?.trim()) falhar("Informe o nome");
  const c = { id: novoId(), nome: d.nome.trim(), whatsapp: d.whatsapp || null, aniversario: d.aniversario || null };
  await banco.inserir("clientes", [c]); E.clientes.push(c);
  return { cliente_id: c.id, ...c };
}

// ---------------------------------------------------------------- "rotas" usadas pelas telas
export async function api(url, opt = {}) {
  const [caminho, qs] = url.split("?"), q = new URLSearchParams(qs || ""), m = (opt.method || "GET").toUpperCase();
  const b = opt.body, seg = caminho.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    switch (`${m} /${seg[0]}${seg[1] && seg[0] === "produtos" ? "/:id" : ""}${seg[2] ? "/" + seg[2] : ""}`) {
      case "GET /config": return verConfig();
      case "PUT /config": return await salvarConfig(b);
      case "GET /categorias": return R.CATEGORIAS;
      case "GET /produtos": {
        const busca = R.semAcento(q.get("busca") || "").toLowerCase();
        return E.produtos.filter((p) => R.semAcento(p.nome).toLowerCase().includes(busca))
          .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.sequencial - b.sequencial).map(produtoJson);
      }
      case "POST /produtos": return await cadastrarProduto(b);
      case "GET /produtos/:id": return produtoJson(produto(seg[1]));
      case "POST /produtos/:id/foto": return await enviarFoto(seg[1], b.get("arquivo"));
      case "POST /produtos/:id/flyer": return await flyer(seg[1], b || {});
      case "GET /pecas": return variacaoJson(acharVariacao(seg[1]));
      case "POST /estoque": return await entradaEstoque(b);
      case "POST /vendas": return await registrarVenda(b);
      case "GET /vendas": return vendasDoDia(q.get("dia") || undefined);
      case "GET /clientes": return [...E.clientes].sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => ({ cliente_id: c.id, ...c }));
      case "POST /clientes": return await novoCliente(b);
      case "GET /promocoes": return seg[1] === "divulgacao" ? divulgacao() : pecasEmPromocao();
      case "POST /promocoes": {
        const r = await rodarRobo();
        return { lotes_avaliados: r.lotes_avaliados, novas_ou_atualizadas: r.novas, no_limite_da_margem: r.no_piso,
          encerradas: r.encerradas, postagens: [] };
      }
      case "GET /painel": return painel();
      default: falhar("Função não encontrada: " + url);
    }
  } catch (e) {
    throw new Error(e instanceof ErroApp ? e.message : (e.message || "Erro inesperado"));
  }
}
