// Ciclo da demanda: vendas perdidas (procuras) → lista de compras inteligente → quem avisar quando chega.
// Funções puras (sem banco e sem tela).
import { semAcento, chaveTamanho, brl } from "./regras.js";

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const norm = (t) => semAcento(String(t || "")).toLowerCase().trim();
const seg = (cat, tam) => `${cat || "?"}|${tam || "?"}`;

// ---------------------------------------------------------------- radar de vendas perdidas
/** procuras: [{categoria, tamanho, cor, descricao, cliente_id, nome, data, status}] */
export function radar(procuras, { precoMedioCat = {}, nomesCat = {}, dias = 90, hoje = new Date() } = {}) {
  const limite = new Date(hoje.getTime() - dias * 864e5);
  const abertas = procuras.filter((p) => p.status === "aberta" && new Date(p.data) >= limite);
  const g = new Map();
  for (const p of abertas) {
    const k = seg(p.categoria, p.tamanho);
    const x = g.get(k) || { categoria: p.categoria, nome_cat: nomesCat[p.categoria] || p.descricao || "Peça", tamanho: p.tamanho || null,
      pedidos: 0, cores: {}, descricoes: new Set(), pessoas: new Set() };
    x.pedidos++;
    if (p.cor) x.cores[p.cor] = (x.cores[p.cor] || 0) + 1;
    if (p.descricao) x.descricoes.add(p.descricao);
    if (p.cliente_id || p.nome) x.pessoas.add(p.cliente_id || p.nome);
    g.set(k, x);
  }
  const itens = [...g.values()].map((x) => ({
    categoria: x.categoria, nome_cat: x.nome_cat, tamanho: x.tamanho, pedidos: x.pedidos,
    cores: Object.entries(x.cores).sort((a, b) => b[1] - a[1]).map(([c]) => c),
    descricoes: [...x.descricoes].slice(0, 3), pessoas_para_avisar: x.pessoas.size,
    valor_perdido: r2(x.pedidos * (precoMedioCat[x.categoria] || 0)),
  })).sort((a, b) => b.pedidos - a.pedidos || b.valor_perdido - a.valor_perdido);
  return { itens, total_pedidos: abertas.length, valor_perdido: r2(itens.reduce((s, i) => s + i.valor_perdido, 0)), dias };
}

// ---------------------------------------------------------------- compra inteligente
/**
 * vendidos: [{categoria, tamanho, cor, qtd}] (últimos 60 dias)
 * estoque:  [{categoria, tamanho, cor, disponivel, dias, custo, preco}]  (por lote/variação)
 * procuras: abertas dos últimos 60 dias
 * Retorna o que comprar dentro do orçamento, priorizando lucro × chance de vender, e o que NÃO comprar.
 */
export function listaCompras({ vendidos, estoque, procuras, orcamento, nomesCat = {}, diasAlerta = 35 }) {
  const S = new Map();
  const pega = (cat, tam) => {
    const k = seg(cat, tam);
    if (!S.has(k)) S.set(k, { categoria: cat, tamanho: tam, vendidos: 0, pedidos: 0, disponivel: 0, parado: 0, custos: [], precos: [], cores: {} });
    return S.get(k);
  };
  for (const v of vendidos) { const s = pega(v.categoria, v.tamanho); s.vendidos += v.qtd; if (v.cor) s.cores[v.cor] = (s.cores[v.cor] || 0) + v.qtd; }
  for (const p of procuras) { if (!p.categoria) continue; const s = pega(p.categoria, p.tamanho); s.pedidos++; if (p.cor) s.cores[p.cor] = (s.cores[p.cor] || 0) + 1.5; }
  for (const e of estoque) {
    const s = pega(e.categoria, e.tamanho);
    s.disponivel += e.disponivel; if (e.dias >= diasAlerta) s.parado += e.disponivel;
    s.custos.push([e.custo, Math.max(1, e.disponivel)]); s.precos.push([e.preco, Math.max(1, e.disponivel)]);
  }
  // custo e preço médios por categoria (para segmentos sem estoque atual)
  const porCat = {};
  for (const e of estoque) { const c = porCat[e.categoria] ||= { c: 0, p: 0, n: 0 }; c.c += e.custo; c.p += e.preco; c.n++; }
  const media = (arr) => { const n = arr.reduce((s, [, w]) => s + w, 0); return n ? arr.reduce((s, [v, w]) => s + v * w, 0) / n : 0; };

  const segmentos = [], evitar = [], novos = [];
  for (const s of S.values()) {
    const custo = media(s.custos) || (porCat[s.categoria] ? porCat[s.categoria].c / porCat[s.categoria].n : 0);
    const preco = media(s.precos) || (porCat[s.categoria] ? porCat[s.categoria].p / porCat[s.categoria].n : 0);
    const nome = nomesCat[s.categoria] || s.categoria;
    if (s.parado >= 2 && s.vendidos === 0 && s.pedidos === 0) {
      evitar.push({ categoria: s.categoria, nome_cat: nome, tamanho: s.tamanho, parado: s.parado,
        motivo: `${s.parado} peça(s) parada(s) e nenhuma venda em 60 dias` });
      continue;
    }
    if (!custo || !preco || preco <= custo) {
      if (s.pedidos) novos.push({ categoria: s.categoria, nome_cat: nome, tamanho: s.tamanho, pedidos: s.pedidos,
        cores: Object.keys(s.cores).slice(0, 3) });
      continue;
    }
    const demanda30 = s.vendidos / 2 + s.pedidos * 0.6;
    const necessidade = Math.ceil(Math.max(0, demanda30 - (s.disponivel - s.parado * 0.5)));
    if (necessidade <= 0) continue;
    const lucroUnit = preco - custo;
    const peso = lucroUnit * (s.pedidos > 0 ? 1.5 : 1) * (s.vendidos > 0 ? 1 : 0.75);
    segmentos.push({ ...s, nome_cat: nome, custo: r2(custo), preco: r2(preco), lucroUnit, peso, necessidade, qtd: 0 });
  }

  // distribui o orçamento peça por peça, sempre na de maior retorno (com retorno decrescente no mesmo item)
  let resta = orcamento;
  for (;;) {
    let melhor = null, nota = 0;
    for (const s of segmentos) {
      if (s.qtd >= s.necessidade || s.custo > resta) continue;
      const n = s.peso * 0.88 ** s.qtd;
      if (n > nota) { nota = n; melhor = s; }
    }
    if (!melhor) break;
    melhor.qtd++; resta -= melhor.custo;
  }
  const compras = segmentos.filter((s) => s.qtd > 0).map((s) => {
    const motivo = [s.vendidos ? `vendeu ${s.vendidos} em 60 dias` : null, s.pedidos ? `${s.pedidos} pedido(s) sem ter` : null,
      `tem ${s.disponivel} em estoque`].filter(Boolean).join(" · ");
    return { categoria: s.categoria, nome_cat: s.nome_cat, tamanho: s.tamanho, qtd: s.qtd,
      cores: Object.entries(s.cores).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 3),
      custo_unit: s.custo, custo_total: r2(s.qtd * s.custo), venda_prevista: r2(s.qtd * s.preco), lucro_previsto: r2(s.qtd * s.lucroUnit), motivo };
  }).sort((a, b) => b.lucro_previsto - a.lucro_previsto || chaveTamanho(a.tamanho) - chaveTamanho(b.tamanho));
  const gasto = r2(compras.reduce((s, c) => s + c.custo_total, 0));
  return { orcamento, compras, gasto, sobra: r2(orcamento - gasto), pecas: compras.reduce((s, c) => s + c.qtd, 0),
    venda_prevista: r2(compras.reduce((s, c) => s + c.venda_prevista, 0)), lucro_previsto: r2(compras.reduce((s, c) => s + c.lucro_previsto, 0)),
    evitar: evitar.sort((a, b) => b.parado - a.parado), testar: novos.sort((a, b) => b.pedidos - a.pedidos), poucos_dados: S.size === 0 || (!vendidos.length && !procuras.length) };
}

// ---------------------------------------------------------------- quem avisar quando a peça chega
/** Procuras abertas que essa peça atende (mesma categoria, tamanho disponível e cor, se a pessoa pediu cor). */
export function procurasAtendidas(procuras, produto, variacoes) {
  const disp = variacoes.filter((v) => v.disponivel > 0);
  const nomeProd = norm(produto.nome);
  return procuras.filter((p) => p.status === "aberta").map((p) => {
    const mesmoTipo = p.categoria ? p.categoria === produto.categoria
      : (p.descricao && norm(p.descricao).split(/\s+/).some((w) => w.length > 3 && nomeProd.includes(w.replace(/s$/, ""))));
    if (!mesmoTipo) return null;
    const vs = disp.filter((v) => (!p.tamanho || v.tamanho === p.tamanho) && (!p.cor || norm(v.cor).includes(norm(p.cor)) || norm(p.cor).includes(norm(v.cor))));
    return vs.length ? { procura: p, variacao: vs[0] } : null;
  }).filter(Boolean);
}

/**
 * perfis: [{cliente_id, nome, whatsapp, tamanhos:{M:3}, categorias:{VES:2}, total, ultima}]
 * Escolhe as clientes com mais chance de comprar a novidade: veste o tamanho e compra esse tipo de peça.
 */
export function clientesParaNovidade(perfis, produto, variacoes, hoje = new Date()) {
  const tamsDisp = [...new Set(variacoes.filter((v) => v.disponivel > 0).map((v) => v.tamanho))];
  return perfis.filter((c) => c.whatsapp).map((c) => {
    const tamCliente = Object.entries(c.tamanhos).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const tam = tamCliente.find((t) => tamsDisp.includes(t)) || null;
    const gostaTipo = (c.categorias[produto.categoria] || 0) > 0;
    if (!tam && (tamCliente.length || !gostaTipo)) return null;   // não tem o tamanho dela
    const dias = c.ultima ? Math.round((hoje - new Date(c.ultima)) / 864e5) : 999;
    const nota = (tam ? 3 : 0) + (gostaTipo ? 2 : 0) + Math.min(2, c.total / 500) + (dias <= 60 ? 1 : 0);
    return { cliente_id: c.cliente_id, nome: c.nome, whatsapp: c.whatsapp, tamanho: tam, gosta_tipo: gostaTipo, dias_sem_comprar: dias, nota: r2(nota),
      motivo: [tam ? `veste ${tam}` : null, gostaTipo ? "já comprou esse tipo" : null, dias <= 60 ? "comprou recentemente" : null].filter(Boolean).join(" · ") };
  }).filter(Boolean).sort((a, b) => b.nota - a.nota).slice(0, 15);
}

export function msgProcura(p, produto, v, preco, loja, nomeCat = "") {
  const nome = String(p.nome || "").split(/\s+/)[0];
  const pediu = [p.descricao || nomeCat || null, p.cor, p.tamanho ? "tam. " + p.tamanho : null].filter(Boolean).join(" ");
  return `Oi${nome ? ", " + nome : ""}! 💖 Lembra que você procurou ${pediu || "uma peça"} aqui na ${loja}? Chegou! ✨\n\n` +
    `${produto.nome} ${v.cor} – tam. ${v.tamanho} por ${brl(preco)}.\n\nQuer que eu separe pra você?`;
}

export function msgNovidade(c, produto, cores, preco, loja) {
  return `Oi, ${String(c.nome).split(/\s+/)[0]}! 💖 Chegou novidade${c.tamanho ? ` no seu tamanho (${c.tamanho})` : ""} aqui na ${loja}:\n\n` +
    `✨ ${produto.nome}${cores.length ? ` – ${cores.join(", ")}` : ""} por ${brl(preco)}\n\nLembrei de você! Quer que eu mande foto ou separe uma?`;
}
