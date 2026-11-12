// "Servidor dentro da página": mesmas operações da API Python, agora rodando no aparelho
// e gravando no Supabase (ou no próprio aparelho, no modo demonstração).
import { novoId } from "./banco.js";
import * as R from "./regras.js";
import { gerarFlyer } from "./flyer.js";
import { coresDaLogo } from "./tema.js";
import * as F from "./financas.js";

const FORMAS = ["pix", "dinheiro", "debito", "credito", "fiado"];
let banco, E;  // E = estado em memória (todas as tabelas)

export async function iniciarServico(b) {
  banco = b;
  E = await banco.carregar();
  if (banco.prepararFotos) await banco.prepararFotos([...E.produtos.map((p) => p.foto), E.config.logo]);
  await verificarRelampago();  // troca a etapa do "salvar meu dia", se passou o horário
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
  await verificarRelampago();
  const id = novoId();
  const r = await banco.registrarVenda({ id, forma: d.forma_pagamento, clienteId: d.cliente_id || null,
    desconto: d.desconto_extra || 0, itens });
  E = await banco.carregar();  // recarrega estoque e vendas como ficaram no banco
  if (banco.prepararFotos) await banco.prepararFotos([...E.produtos.map((p) => p.foto), E.config.logo]);
  const ev = await verificarRelampago();  // a peça relâmpago pode ter sido vendida agora
  const lucro = Math.round((r.total - r.custo - r.taxa_maquininha) * 100) / 100;
  return { ...r, lucro, alerta: lucro < 0 ? "Atenção: essa venda deu prejuízo." : null, relampago: ev };
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
  const agora = new Date();
  for (const l of E.lotes.filter((x) => x.quantidade_atual > 0)) {
    if (l.relampago_ate && new Date(l.relampago_ate) > agora) continue;  // em promoção relâmpago: não mexe
    res.lotes_avaliados++;
    const c = R.calcularPromo(l, E.config);
    if (c.preco === l.preco_promocional && c.no_piso === l.promo_no_piso && !l.relampago_ate) continue;
    const v = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === v.produto_id);
    const info = { lote_id: l.id, produto_id: p.id, codigo: v.codigo, produto: p.nome, cor: v.cor, tamanho: v.tamanho,
      quantidade: l.quantidade_atual, dias_em_loja: c.dias, preco_cheio: l.preco_venda, preco_promocional: c.preco,
      desconto_pct: c.desconto_pct, custo: l.custo_unit, piso: c.piso };
    if (c.preco == null && l.preco_promocional != null) res.encerradas++;
    const campos = { preco_promocional: c.preco, desconto_pct: c.preco ? c.desconto_pct : 0, promo_no_piso: c.no_piso,
      promo_desde: c.preco ? (l.promo_desde || R.hojeISO()) : null, relampago_ate: null };
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
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const r2 = (v) => Math.round(v * 100) / 100;

function intervalo(periodo, agora = new Date()) {
  const hoje = inicioDia(agora), amanha = somaDias(hoje, 1);
  switch (periodo) {
    case "hoje": return { ini: hoje, fim: amanha, antIni: somaDias(hoje, -1), antFim: hoje, rotulo: "ontem" };
    case "7d": return { ini: somaDias(hoje, -6), fim: amanha, antIni: somaDias(hoje, -13), antFim: somaDias(hoje, -6), rotulo: "7 dias anteriores" };
    case "ano": {
      const ini = new Date(hoje.getFullYear(), 0, 1);
      return { ini, fim: amanha, antIni: new Date(hoje.getFullYear() - 1, 0, 1),
        antFim: new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate() + 1), rotulo: "mesmo período do ano passado" };
    }
    default: {  // mês
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const antIni = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const diasMesAnt = new Date(hoje.getFullYear(), hoje.getMonth(), 0).getDate();
      return { ini, fim: amanha, antIni, antFim: somaDias(antIni, Math.min(hoje.getDate(), diasMesAnt)), rotulo: "mesmo período do mês passado" };
    }
  }
}

function resumoVendas(vendas) {
  const ids = new Set(vendas.map((v) => v.id));
  const pecas = E.itens_venda.filter((i) => ids.has(i.venda_id)).reduce((s, i) => s + i.quantidade, 0);
  const fat = vendas.reduce((s, v) => s + v.total, 0), custo = vendas.reduce((s, v) => s + v.custo_total, 0);
  const taxas = vendas.reduce((s, v) => s + v.taxa_pagamento, 0), lucro = fat - custo - taxas;
  return { faturamento: r2(fat), custo: r2(custo), taxas: r2(taxas), lucro: r2(lucro), vendas: vendas.length, pecas,
    ticket: vendas.length ? r2(fat / vendas.length) : 0, pecas_por_venda: vendas.length ? Math.round(pecas / vendas.length * 10) / 10 : 0,
    margem: fat ? Math.round(lucro / fat * 1000) / 10 : 0 };
}
const variacao = (a, b) => (b ? Math.round((a - b) / b * 1000) / 10 : (a ? null : 0));

function painel(periodo = "mes") {
  const cfg = E.config, agora = new Date(), I = intervalo(periodo, agora);
  const entre = (v, a, b) => { const d = new Date(v.data); return d >= a && d < b; };
  const vendas = E.vendas.filter((v) => entre(v, I.ini, I.fim)), anteriores = E.vendas.filter((v) => entre(v, I.antIni, I.antFim));
  const atual = resumoVendas(vendas), ant = resumoVendas(anteriores);
  const comp = {}; for (const k of ["faturamento", "lucro", "vendas", "ticket", "pecas"]) comp[k] = variacao(atual[k], ant[k]);

  // série para o gráfico
  const serie = [];
  if (periodo === "ano") {
    for (let m = 0; m <= agora.getMonth(); m++) {
      const a = new Date(agora.getFullYear(), m, 1), b = new Date(agora.getFullYear(), m + 1, 1);
      serie.push({ rotulo: MESES[m], valor: r2(E.vendas.filter((v) => entre(v, a, b)).reduce((s, v) => s + v.total, 0)) });
    }
  } else {
    const ini = periodo === "hoje" ? somaDias(inicioDia(agora), -6) : I.ini;
    for (let d = ini; d < I.fim; d = somaDias(d, 1)) {
      const b = somaDias(d, 1);
      serie.push({ rotulo: `${d.getDate()}/${d.getMonth() + 1}`, valor: r2(E.vendas.filter((v) => entre(v, d, b)).reduce((s, v) => s + v.total, 0)),
        hoje: +d === +inicioDia(agora) });
    }
  }

  // formas de pagamento, produtos, tamanhos, categorias
  const formas = {}; vendas.forEach((v) => (formas[v.forma_pagamento] = r2((formas[v.forma_pagamento] || 0) + v.total)));
  const ids = new Set(vendas.map((v) => v.id)), itens = E.itens_venda.filter((i) => ids.has(i.venda_id));
  const porProd = new Map(), porTam = new Map(), porCat = new Map();
  for (const it of itens) {
    const va = E.variacoes.find((x) => x.id === it.variacao_id); if (!va) continue;
    const p = E.produtos.find((x) => x.id === va.produto_id); if (!p) continue;
    const g = porProd.get(p.id) || { produto_id: p.id, nome: p.nome, foto: banco.urlFoto(p.foto), qtd: 0, faturamento: 0, lucro: 0 };
    g.qtd += it.quantidade; g.faturamento = r2(g.faturamento + it.quantidade * it.preco_unit);
    g.lucro = r2(g.lucro + it.quantidade * (it.preco_unit - it.custo_unit)); porProd.set(p.id, g);
    porTam.set(va.tamanho, (porTam.get(va.tamanho) || 0) + it.quantidade);
    const cat = R.CATEGORIAS[p.categoria] || p.categoria;
    porCat.set(cat, r2((porCat.get(cat) || 0) + it.quantidade * it.preco_unit));
  }
  const maisVendidos = [...porProd.values()].sort((a, b) => b.qtd - a.qtd || b.faturamento - a.faturamento).slice(0, 5);

  // estoque
  const ls = E.lotes.filter((l) => l.quantidade_atual > 0);
  const escada = R.lerEscada(cfg.escada_promocao), diasAlerta = escada.length ? escada[0][0] : 35;
  const parados = ls.filter((l) => R.diasEntre(l.data_entrada) >= diasAlerta);
  const soma = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  const encalhados = parados.map((l) => {
    const va = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === va.produto_id);
    return { produto_id: p.id, nome: p.nome, foto: banco.urlFoto(p.foto), cor: va.cor, tamanho: va.tamanho, qtd: l.quantidade_atual,
      dias: R.diasEntre(l.data_entrada), preco: R.precoAtual(l), em_promocao: l.preco_promocional != null };
  }).sort((a, b) => b.dias - a.dias).slice(0, 5);
  const estoqueTam = new Map();
  for (const l of ls) { const va = E.variacoes.find((x) => x.id === l.variacao_id); estoqueTam.set(va.tamanho, (estoqueTam.get(va.tamanho) || 0) + l.quantidade_atual); }

  // meta do mês
  const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1), fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  const vendidoMes = soma(E.vendas.filter((v) => entre(v, iniMes, fimMes)), (v) => v.total);
  const diasRestantes = Math.round((fimMes - inicioDia(agora)) / 86400000);
  const meta = cfg.meta_mensal > 0 ? { valor: cfg.meta_mensal, vendido: vendidoMes, pct: Math.round(vendidoMes / cfg.meta_mensal * 1000) / 10,
    falta: r2(Math.max(0, cfg.meta_mensal - vendidoMes)), dias_restantes: diasRestantes,
    por_dia: r2(Math.max(0, cfg.meta_mensal - vendidoMes) / Math.max(1, diasRestantes)),
    ritmo: r2(vendidoMes / agora.getDate() * new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate()) } : null;

  // resultado por mês (últimos 6) – DRE simplificado
  const dre = [];
  for (let k = 5; k >= 0; k--) {
    const a = new Date(agora.getFullYear(), agora.getMonth() - k, 1), b = new Date(agora.getFullYear(), agora.getMonth() - k + 1, 1);
    const r = resumoVendas(E.vendas.filter((v) => entre(v, a, b)));
    dre.push({ rotulo: MESES[a.getMonth()], faturamento: r.faturamento, custo: r.custo, taxas: r.taxas, lucro: r.lucro });
  }

  // aniversariantes do mês
  const aniversariantes = E.clientes.filter((c) => c.aniversario && +c.aniversario.slice(5, 7) === agora.getMonth() + 1)
    .map((c) => ({ nome: c.nome, dia: +c.aniversario.slice(8, 10), whatsapp: c.whatsapp, hoje: +c.aniversario.slice(8, 10) === agora.getDate() }))
    .sort((a, b) => a.dia - b.dia);

  // MEI
  const ano = agora.getFullYear(), faturadoAno = soma(E.vendas.filter((v) => new Date(v.data).getFullYear() === ano), (v) => v.total);
  const projecao = faturadoAno / (agora.getMonth() + 1) * 12, uso = faturadoAno / cfg.limite_mei_anual * 100;
  let alerta = null;
  if (uso >= 100) alerta = "Limite do MEI ultrapassado! Procure um contador.";
  else if (uso >= 80 || projecao > cfg.limite_mei_anual) alerta = "Atenção: no ritmo atual você pode passar do limite do MEI este ano.";

  // vendas × meta: semanas do mês (ou meses do ano)
  const vsMeta = [], diasMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  if (periodo === "ano") {
    for (let m = 0; m <= agora.getMonth(); m++) {
      const a = new Date(agora.getFullYear(), m, 1), b = new Date(agora.getFullYear(), m + 1, 1);
      vsMeta.push({ rotulo: MESES[m], vendas: r2(E.vendas.filter((v) => entre(v, a, b)).reduce((s, v) => s + v.total, 0)), meta: cfg.meta_mensal || null });
    }
  } else {
    for (let ini = 1, k = 1; ini <= diasMes; ini += 7, k++) {
      const fim = Math.min(diasMes, ini + 6);
      const a = new Date(agora.getFullYear(), agora.getMonth(), ini), b = new Date(agora.getFullYear(), agora.getMonth(), fim + 1);
      vsMeta.push({ rotulo: `Sem ${k}`, detalhe: `${ini}–${fim}/${agora.getMonth() + 1}`, vendas: r2(E.vendas.filter((v) => entre(v, a, b)).reduce((s, v) => s + v.total, 0)),
        meta: cfg.meta_mensal ? r2(cfg.meta_mensal * (fim - ini + 1) / diasMes) : null, futura: a > agora });
    }
  }
  // minigráficos: últimos 14 dias
  const spark = { faturamento: [], lucro: [], vendas: [], ticket: [] };
  for (let k = 13; k >= 0; k--) {
    const a = somaDias(inicioDia(agora), -k), r = resumoVendas(E.vendas.filter((v) => entre(v, a, somaDias(a, 1))));
    spark.faturamento.push(r.faturamento); spark.lucro.push(r.lucro); spark.vendas.push(r.vendas); spark.ticket.push(r.ticket);
  }

  return {
    periodo, comparado_com: I.rotulo, atual, comparacao: comp, serie, formas, vs_meta: vsMeta, spark,
    mais_vendidos: maisVendidos,
    vendas_por_tamanho: [...porTam].sort((a, b) => R.chaveTamanho(a[0]) - R.chaveTamanho(b[0])).map(([t, q]) => ({ rotulo: t, valor: q })),
    vendas_por_categoria: [...porCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ rotulo: c, valor: v })),
    fiado: soma(vendas.filter((v) => v.forma_pagamento === "fiado"), (v) => v.total),
    meta, dre, aniversariantes, encalhados,
    estoque: { pecas: ls.reduce((s, l) => s + l.quantidade_atual, 0), custo: soma(ls, (l) => l.quantidade_atual * l.custo_unit),
      venda: soma(ls, (l) => l.quantidade_atual * R.precoAtual(l)), pecas_paradas: parados.reduce((s, l) => s + l.quantidade_atual, 0),
      dinheiro_parado: soma(parados, (l) => l.quantidade_atual * l.custo_unit), dias_alerta: diasAlerta,
      em_promocao: ls.filter((l) => l.preco_promocional != null).reduce((s, l) => s + l.quantidade_atual, 0),
      por_tamanho: [...estoqueTam].sort((a, b) => R.chaveTamanho(a[0]) - R.chaveTamanho(b[0])).map(([t, q]) => ({ rotulo: t, valor: q })) },
    mei: { ano, faturado: faturadoAno, limite: cfg.limite_mei_anual, uso_pct: Math.round(uso * 10) / 10, projecao_ano: r2(projecao), alerta },
  };
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

async function enviarLogo(arquivo) {
  let bmp; try { bmp = await createImageBitmap(arquivo); } catch { falhar("Arquivo não é uma imagem válida"); }
  const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));  // PNG mantém o fundo transparente
  const cores = await coresDaLogo(c);
  const caminho = await banco.enviarFoto("logo", blob);
  const antiga = E.config.logo;
  E.config = { ...E.config, ...(await banco.salvarConfig({ logo: caminho, cor_primaria: cores[0] || null, cor_secundaria: cores[1] || null })) };
  if (antiga) banco.apagarFoto(antiga).catch(() => {});
  return { ...verConfig(), cores_da_logo: cores };
}

function dadosFlyer(p, tipo) {
  let ls = variacoesDe(p.id).flatMap((v) => lotesDe(v.id).filter((l) => l.quantidade_atual > 0).map((l) => [v, l]));
  if (tipo === "relampago") {
    const it = relampagoAtivo()?.itens.find((i) => i.status === "ativa" && i.produto_id === p.id);
    if (!it) falhar("Esse produto não está na promoção relâmpago agora.");
    const l = E.lotes.find((x) => x.id === it.lote_id), v = E.variacoes.find((x) => x.id === it.variacao_id);
    const ate = new Date(it.fim), hora = `${ate.getHours()}h${ate.getMinutes() ? String(ate.getMinutes()).padStart(2, "0") : ""}`;
    return { produto_id: p.id, nome: p.nome, tipo, preco_de: it.preco_antes, preco_por: l.preco_promocional ?? it.preco_relampago,
      desconto_pct: it.desconto_pct, tamanhos: [v.tamanho], cores: [v.cor], foto: banco.urlFoto(p.foto), ate: hora,
      selo: "RELÂMPAGO", chamada: `Só até as ${hora} · chama no direct!`,
      loja: E.config.nome_loja, arroba: E.config.instagram_arroba, whatsapp: E.config.whatsapp_loja,
      logo: banco.urlFoto(E.config.logo), cor_primaria: E.config.cor_primaria, cor_secundaria: E.config.cor_secundaria };
  }
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
    loja: E.config.nome_loja, arroba: E.config.instagram_arroba, whatsapp: E.config.whatsapp_loja,
    logo: banco.urlFoto(E.config.logo), cor_primaria: E.config.cor_primaria, cor_secundaria: E.config.cor_secundaria };
}

async function flyer(pid, { tipo = "promo", formatos = ["feed", "story"] }) {
  const d = dadosFlyer(produto(pid), tipo), leg = R.legenda(d);
  const out = [];
  for (const f of formatos) out.push({ formato: f, tipo, url: URL.createObjectURL(await gerarFlyer(d, f)), legenda: leg });
  return out;
}

// ---------------------------------------------------------------- dinheiro: contas, metas, capital, sonhos
const mesISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const lucroDe = (vs) => vs.reduce((s, v) => s + v.total - v.custo_total - v.taxa_pagamento, 0);
const vendasEntre = (a, b) => E.vendas.filter((v) => { const d = new Date(v.data); return d >= a && d < b; });

function financas() {
  const cfg = E.config, agora = new Date(), hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const despesas = [...E.despesas].sort((a, b) => (a.ordem - b.ordem) || String(a.criado_em).localeCompare(String(b.criado_em)));
  const tot = F.totalDespesas(despesas);
  const ultimos90 = vendasEntre(new Date(hoje.getTime() - 90 * 864e5), new Date(hoje.getTime() + 864e5));
  const { margem, fonte } = F.margemBruta(ultimos90, E.lotes);

  // hoje
  const vHoje = vendasEntre(hoje, new Date(hoje.getTime() + 864e5));
  const termo = F.termometroDia({ custoDiario: tot.diario, lucroHoje: lucroDe(vHoje), vendasHoje: vHoje.reduce((s, v) => s + v.total, 0), margem });
  termo.divisao_sobra = F.dividirSobra(termo.sobra, cfg);

  // mês atual
  const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const vMes = vendasEntre(iniMes, new Date(hoje.getTime() + 864e5)), lucroMes = lucroDe(vMes), dia = agora.getDate();
  const contasAteHoje = Math.min(tot.mensal, tot.diario * dia);
  const mes = { vendas: Math.round(vMes.reduce((s, v) => s + v.total, 0) * 100) / 100, lucro_bruto: Math.round(lucroMes * 100) / 100,
    contas_ate_hoje: Math.round(contasAteHoje * 100) / 100, resultado: Math.round((lucroMes - contasAteHoje) * 100) / 100,
    projecao: Math.round((lucroMes / dia * F.DIAS_MES - tot.mensal) * 100) / 100 };

  // sobra média dos últimos 3 meses fechados (base do ritmo dos sonhos)
  const sobras = [];
  for (let k = 1; k <= 3; k++) {
    const a = new Date(agora.getFullYear(), agora.getMonth() - k, 1), b = new Date(agora.getFullYear(), agora.getMonth() - k + 1, 1);
    const vs = vendasEntre(a, b); if (vs.length) sobras.push(lucroDe(vs) - tot.mensal);
  }
  const sobraMedia = sobras.length ? sobras.reduce((s, v) => s + v, 0) / sobras.length : Math.max(0, mes.projecao);
  const div = F.dividirSobra(Math.max(0, sobraMedia), cfg);

  // sonhos
  const ativos = E.sonhos.filter((s) => !s.concluido);
  const pctSonhos = (cfg.pct_sonhos ?? 10) / ((cfg.pct_reinvestir ?? 30) + (cfg.pct_reserva ?? 10) + (cfg.pct_salario ?? 50) + (cfg.pct_sonhos ?? 10) || 100) * 100;
  const sonhos = [...E.sonhos].sort((a, b) => a.concluido - b.concluido || String(a.criado_em).localeCompare(String(b.criado_em)))
    .map((s) => ({ ...s, plano: F.planoSonho(s, { hoje: R.hojeISO(), sobraSonhosMes: div.sonhos, margem, pctSonhos, totalSonhosAtivos: ativos.length, sobraTotalMes: Math.max(0, sobraMedia) }) }));
  const sonhosMes = sonhos.filter((s) => !s.concluido && s.plano.por_mes).reduce((t, s) => t + s.plano.por_mes, 0);

  // fechamento do mês passado: sugestão de quanto guardar
  const iniPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1), chavePassado = mesISO(iniPassado);
  const vPassado = vendasEntre(iniPassado, iniMes), sobraPassado = Math.round((lucroDe(vPassado) - tot.mensal) * 100) / 100;
  let fechamento = null;
  if (vPassado.length && cfg.ultimo_mes_dividido !== chavePassado) {
    const d = F.dividirSobra(sobraPassado, cfg);
    const porSonho = ativos.length ? d.sonhos / ativos.length : 0;
    fechamento = { mes: chavePassado, sobra: sobraPassado, positivo: sobraPassado > 0, divisao: d,
      sonhos: ativos.map((s) => ({ id: s.id, nome: s.nome, emoji: s.emoji,
        valor: Math.round(Math.min(porSonho, Math.max(0, s.valor - s.guardado)) * 100) / 100 })).filter((x) => x.valor > 0) };
  }

  // capital de giro (markup do estoque atual)
  let venda = 0, custo = 0;
  for (const l of E.lotes) if (l.quantidade_atual > 0) { venda += l.quantidade_atual * l.preco_venda; custo += l.quantidade_atual * l.custo_unit; }
  const capital = F.planoCapital({ capital: cfg.capital_inicial, despesasMes: tot.mensal, markup: custo ? venda / custo : 2 });

  return {
    despesas: tot.itens.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo, valor: d.valor, valores: d.valores || [], previsto: d.previsto })),
    contas_mes: tot.mensal, contas_dia: tot.diario, margem: Math.round(margem * 1000) / 10, margem_fonte: fonte,
    venda_minima_dia: F.vendaNecessaria(tot.diario, margem), hoje: termo, mes,
    meta: F.metaMensal({ despesasMes: tot.mensal, salario: cfg.salario_desejado || 0, sonhosMes, margem, cfg }),
    salario_desejado: cfg.salario_desejado || 0, sobra_media_mes: Math.round(sobraMedia * 100) / 100, divisao_media: div,
    percentuais: { pct_reinvestir: cfg.pct_reinvestir ?? 30, pct_reserva: cfg.pct_reserva ?? 10, pct_salario: cfg.pct_salario ?? 50, pct_sonhos: cfg.pct_sonhos ?? 10 },
    capital, capital_inicial: cfg.capital_inicial || 0, sonhos, fechamento, relampago: relampagoJson(),
  };
}

async function salvarDespesa(id, d) {
  if (!d.nome?.trim()) falhar("Dê um nome para a conta.");
  const tipo = d.tipo === "media" ? "media" : "fixa";
  const valores = (d.valores || []).map(Number).filter((v) => v > 0).slice(-3);
  if (tipo === "fixa" && !(Number(d.valor) > 0)) falhar("Informe o valor da conta.");
  if (tipo === "media" && !valores.length) falhar("Informe pelo menos 1 conta anterior.");
  const campos = { nome: d.nome.trim(), tipo, valor: tipo === "fixa" ? Number(d.valor) : 0, valores };
  if (id) { await banco.atualizar("despesas", id, campos); Object.assign(E.despesas.find((x) => x.id === id) || {}, campos); }
  else { const n = { id: novoId(), ordem: E.despesas.length, criado_em: new Date().toISOString(), ...campos }; await banco.inserir("despesas", [n]); E.despesas.push(n); }
  return financas();
}

async function salvarSonho(d) {
  if (!d.nome?.trim()) falhar("Qual é o seu sonho?");
  if (!(Number(d.valor) > 0)) falhar("Quanto custa esse sonho?");
  const s = { id: novoId(), nome: d.nome.trim(), emoji: d.emoji || "⭐", valor: Number(d.valor), prazo: d.prazo || null,
    guardado: 0, concluido: false, criado_em: new Date().toISOString() };
  await banco.inserir("sonhos", [s]); E.sonhos.push(s);
  return financas();
}

async function guardarNoSonho(id, valor, origem = "manual") {
  const s = E.sonhos.find((x) => x.id === id) || falhar("Sonho não encontrado");
  valor = Math.round(Number(valor) * 100) / 100;
  if (!valor) falhar("Informe o valor.");
  const a = { id: novoId(), sonho_id: id, valor, data: new Date().toISOString(), origem };
  await banco.inserir("aportes", [a]); E.aportes.push(a);
  const guardado = Math.round(((s.guardado || 0) + valor) * 100) / 100, concluido = guardado >= s.valor;
  await banco.atualizar("sonhos", id, { guardado, concluido }); Object.assign(s, { guardado, concluido });
  return { ...financas(), conquistou: concluido ? s.nome : null };
}

async function dividirMes(d) {
  for (const x of d.sonhos || []) if (x.valor > 0) await guardarNoSonho(x.id, x.valor, "sobra do mês");
  E.config = { ...E.config, ...(await banco.salvarConfig({ ultimo_mes_dividido: d.mes })) };
  return financas();
}

// ---------------------------------------------------------------- pulso da loja: anéis, missões, sequência, conquistas
function pulso() {
  const cfg = E.config, agora = new Date(), hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const fin = financas(), h = fin.hoje, diasMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const doDia = (d) => vendasEntre(d, new Date(d.getTime() + 864e5));
  const vHoje = doDia(hoje);
  const metaDia = cfg.meta_mensal > 0 ? cfg.meta_mensal / diasMes : (fin.meta.por_dia || 0);
  const vendasMes = fin.mes.vendas;
  const aneis = [];
  if (h.custo_diario > 0) aneis.push({ id: "contas", nome: "Contas do dia", valor: h.lucro_hoje, alvo: h.custo_diario, dica: "lucro de hoje × contas do dia" });
  if (metaDia > 0) aneis.push({ id: "dia", nome: "Meta do dia", valor: h.vendas_hoje, alvo: Math.round(metaDia * 100) / 100, dica: "vendas de hoje" });
  if (cfg.meta_mensal > 0) aneis.push({ id: "mes", nome: "Meta do mês", valor: vendasMes, alvo: cfg.meta_mensal, dica: "vendas do mês" });

  // missões do dia (calculadas a partir dos dados, nada para marcar à mão)
  const ticket = fin.mes.vendas && E.vendas.length ? vendasMes / Math.max(1, E.vendas.filter((v) => new Date(v.data) >= new Date(agora.getFullYear(), agora.getMonth(), 1)).length) : 0;
  const nVendas = Math.min(8, Math.max(2, Math.ceil((metaDia || h.venda_para_cobrir || 0) / (ticket || 80)) || 2));
  const escada = R.lerEscada(cfg.escada_promocao), diasAlerta = escada.length ? escada[0][0] : 35;
  const idsHoje = new Set(vHoje.map((v) => v.id));
  const vendeuParada = E.itens_venda.some((iv) => idsHoje.has(iv.venda_id) &&
    R.diasEntre(E.lotes.find((l) => l.id === iv.lote_id)?.data_entrada || R.hojeISO()) >= diasAlerta);
  const temParada = E.lotes.some((l) => l.quantidade_atual > 0 && R.diasEntre(l.data_entrada) >= diasAlerta);
  const missoes = [];
  if (h.custo_diario > 0) missoes.push({ id: "contas", titulo: "Pague as contas de hoje", detalhe: h.falta > 0 ? `faltam ${R.brl(h.falta)} de lucro` : "contas pagas!",
    progresso: Math.min(1, h.lucro_hoje / h.custo_diario), acao: h.falta > 0 ? "salvar_dia" : null });
  else missoes.push({ id: "contas", titulo: "Cadastre as contas da loja", detalhe: "aluguel, luz, água…", progresso: E.despesas.length ? 1 : 0, acao: "dinheiro" });
  missoes.push({ id: "vendas", titulo: `Faça ${nVendas} vendas hoje`, detalhe: `${vHoje.length} de ${nVendas}`, progresso: Math.min(1, vHoje.length / nVendas), acao: "vender" });
  if (temParada || vendeuParada) missoes.push({ id: "parada", titulo: "Venda 1 peça parada", detalhe: `há mais de ${diasAlerta} dias na loja`, progresso: vendeuParada ? 1 : 0, acao: "promo" });
  else missoes.push({ id: "cliente", titulo: "Identifique a cliente em 1 venda", detalhe: "fideliza e libera aniversário e avisos",
    progresso: vHoje.some((v) => v.cliente_id) ? 1 : 0, acao: "vender" });

  // sequência: dias seguidos batendo o objetivo (domingo sem venda não quebra)
  const bateu = (vs) => h.custo_diario > 0 ? lucroDe(vs) >= h.custo_diario : vs.length > 0;
  let seq = 0;
  const hojeBateu = bateu(vHoje);
  for (let k = 1; k < 400; k++) {
    const d = new Date(hoje.getTime() - k * 864e5), vs = doDia(d);
    if (bateu(vs)) seq++;
    else if (d.getDay() === 0 && !vs.length) continue;
    else break;
  }
  if (hojeBateu) seq++;
  const objetivoSeq = h.custo_diario > 0 ? "dias seguidos pagando as contas" : "dias seguidos com venda";

  // recorde do mês e conquistas
  const totalVendas = E.vendas.length, maiorMes = (() => {
    const m = new Map(); E.vendas.forEach((v) => { const k = v.data.slice(0, 7); m.set(k, (m.get(k) || 0) + v.total); });
    return Math.max(0, ...m.values());
  })();
  const conquistas = [
    { id: "primeira", emoji: "🛍️", nome: "Primeira venda", ganho: totalVendas >= 1 },
    { id: "dez", emoji: "🔟", nome: "10 vendas", ganho: totalVendas >= 10 },
    { id: "cem", emoji: "💯", nome: "100 vendas", ganho: totalVendas >= 100 },
    { id: "mil", emoji: "💵", nome: "R$ 1 mil num mês", ganho: maiorMes >= 1000 },
    { id: "dezmil", emoji: "💎", nome: "R$ 10 mil num mês", ganho: maiorMes >= 10000 },
    { id: "meta", emoji: "🎯", nome: "Meta do mês batida", ganho: cfg.meta_mensal > 0 && vendasMes >= cfg.meta_mensal },
    { id: "seq7", emoji: "🔥", nome: "7 dias de sequência", ganho: seq >= 7 },
    { id: "sonho", emoji: "⭐", nome: "Sonho conquistado", ganho: E.sonhos.some((s) => s.concluido) },
  ];
  const hora = agora.getHours(), nome = (cfg.responsavel_nome || "").split(" ")[0];
  const saudacao = `${hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite"}${nome ? ", " + nome : ""}!`;
  return { saudacao, aneis, missoes, missoes_feitas: missoes.filter((m) => m.progresso >= 1).length,
    sequencia: seq, sequencia_texto: objetivoSeq, sequencia_hoje: hojeBateu, conquistas, relampago: !!relampagoAtivo(),
    falta_hoje: h.falta };
}

function rankingClientes() {
  const m = new Map();
  for (const v of E.vendas) if (v.cliente_id) {
    const g = m.get(v.cliente_id) || { total: 0, compras: 0, ultima: v.data };
    g.total += v.total; g.compras++; if (v.data > g.ultima) g.ultima = v.data; m.set(v.cliente_id, g);
  }
  return [...m].map(([id, g]) => ({ ...E.clientes.find((c) => c.id === id), cliente_id: id, total: Math.round(g.total * 100) / 100,
    compras: g.compras, ultima: g.ultima, dias_sem_comprar: R.diasEntre(R.hojeISO(new Date(g.ultima))) }))
    .filter((c) => c.nome).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------- salvar meu dia (promoção relâmpago)
const relampagoAtivo = () => E.relampagos.find((r) => r.status === "ativo");

function relampagoJson() {
  const r = relampagoAtivo(); if (!r) return null;
  const p = (id) => E.produtos.find((x) => x.id === id);
  return { id: r.id, horas: r.horas, itens: r.itens.map((i) => ({ ...i, foto: banco.urlFoto(p(i.produto_id)?.foto) })) };
}

function sugestaoRelampago() {
  const emRelampago = new Set((relampagoAtivo()?.itens || []).map((i) => i.lote_id));
  const cands = E.lotes.filter((l) => l.quantidade_atual > 0 && !emRelampago.has(l.id)).map((l) => {
    const v = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === v.produto_id);
    return { produto_id: p.id, variacao_id: v.id, lote_id: l.id, nome: p.nome, cor: v.cor, tamanho: v.tamanho,
      foto: banco.urlFoto(p.foto), preco: R.precoAtual(l), custo: l.custo_unit, dias: R.diasEntre(l.data_entrada), qtd: l.quantidade_atual };
  });
  const fin = financas();
  return { falta_hoje: fin.hoje.falta, horas: E.config.relampago_horas || 3, itens: F.sugerirRelampago(cands, E.config, fin.hoje.falta) };
}

async function salvarRelampago(r) { await banco.atualizar("relampagos", r.id, { itens: r.itens, status: r.status }); }

async function ativarEtapa(r, i, agora) {
  const it = r.itens[i], l = E.lotes.find((x) => x.id === it.lote_id);
  if (!l || l.quantidade_atual <= 0) { it.status = "pulada"; return false; }
  const fim = new Date(agora.getTime() + r.horas * 3600e3).toISOString();
  Object.assign(it, { status: "ativa", inicio: agora.toISOString(), fim, qtd_inicio: l.quantidade_atual });
  const campos = { preco_promocional: it.preco_relampago, desconto_pct: Math.round((1 - it.preco_relampago / l.preco_venda) * 1000) / 10,
    promo_no_piso: false, relampago_ate: fim };
  await banco.atualizar("lotes", l.id, campos); Object.assign(l, campos);
  return true;
}

async function encerrarEtapa(it, status) {
  it.status = status;
  const l = E.lotes.find((x) => x.id === it.lote_id);
  if (l) {  // volta ao preço normal (com a promoção por dias parados, se tiver)
    const c = R.calcularPromo(l, E.config);
    const campos = { preco_promocional: c.preco, desconto_pct: c.preco ? c.desconto_pct : 0, promo_no_piso: c.no_piso, relampago_ate: null };
    await banco.atualizar("lotes", l.id, campos); Object.assign(l, campos);
  }
}

async function proximaEtapa(r, agora) {
  for (let i = 0; i < r.itens.length; i++) if (r.itens[i].status === "aguardando" && await ativarEtapa(r, i, agora)) return r.itens[i];
  r.status = "concluido"; return null;
}

/** Confere vendas e horários e avança as etapas. Retorna o que mudou (para avisar a pessoa). */
export async function verificarRelampago(agora = new Date()) {
  const r = relampagoAtivo(); if (!r) return null;
  const eventos = [];
  if (r.data !== R.hojeISO(agora)) {  // virou o dia: encerra tudo
    for (const it of r.itens) if (it.status === "ativa") await encerrarEtapa(it, "encerrada");
    r.itens.forEach((it) => { if (it.status === "aguardando") it.status = "pulada"; });
    r.status = "concluido"; await salvarRelampago(r); return { tipo: "fim_do_dia" };
  }
  const ativa = r.itens.find((i) => i.status === "ativa");
  if (ativa) {
    const vendeu = E.itens_venda.some((iv) => iv.lote_id === ativa.lote_id &&
      new Date(E.vendas.find((v) => v.id === iv.venda_id)?.data || 0) >= new Date(ativa.inicio));
    if (vendeu) {
      await encerrarEtapa(ativa, "vendida"); eventos.push({ tipo: "vendida", item: ativa });
      const falta = financas().hoje.falta;
      if (falta <= 0) { r.itens.forEach((i) => { if (i.status === "aguardando") i.status = "nao_precisou"; }); r.status = "concluido"; eventos.push({ tipo: "dia_salvo" }); }
      else { const nx = await proximaEtapa(r, agora); if (nx) eventos.push({ tipo: "nova_etapa", item: nx }); }
    } else if (agora >= new Date(ativa.fim)) {
      await encerrarEtapa(ativa, "encerrada");
      const nx = await proximaEtapa(r, agora); eventos.push(nx ? { tipo: "nova_etapa", item: nx } : { tipo: "acabou" });
    }
  } else if (!r.itens.some((i) => i.status === "aguardando")) r.status = "concluido";
  if (eventos.length || r.status !== "ativo") await salvarRelampago(r);
  return eventos.length ? eventos : null;
}

async function iniciarRelampago(d) {
  if (relampagoAtivo()) falhar("Já existe uma promoção relâmpago em andamento hoje.");
  const itens = (d.itens || []).slice(0, 3).map((x, i) => ({ etapa: i + 1, produto_id: x.produto_id, variacao_id: x.variacao_id,
    lote_id: x.lote_id, nome: x.nome, cor: x.cor, tamanho: x.tamanho, preco_antes: x.preco, preco_relampago: x.preco_relampago,
    desconto_pct: x.desconto_pct, lucro: x.lucro, status: "aguardando", inicio: null, fim: null }));
  if (!itens.length) falhar("Nenhuma peça escolhida.");
  const r = { id: novoId(), data: R.hojeISO(), horas: Number(d.horas) || E.config.relampago_horas || 3, itens, status: "ativo", criado_em: new Date().toISOString() };
  await ativarEtapa(r, 0, new Date());
  await banco.inserir("relampagos", [r]); E.relampagos.push(r);
  return relampagoJson();
}

async function cancelarRelampago() {
  const r = relampagoAtivo(); if (!r) return null;
  for (const it of r.itens) if (it.status === "ativa") await encerrarEtapa(it, "encerrada");
  r.itens.forEach((it) => { if (it.status === "aguardando") it.status = "pulada"; });
  r.status = "cancelado"; await salvarRelampago(r);
  return null;
}

// ---------------------------------------------------------------- config / clientes
const CAMPOS_CONFIG = ["nome_loja", "margem_minima_pct", "taxa_cartao_pct", "considerar_taxa_cartao",
  "escada_promocao", "limite_mei_anual", "instagram_arroba", "whatsapp_loja", "cadastro_completo",
  "responsavel_nome", "responsavel_whatsapp", "responsavel_email", "responsavel_cargo", "loja_razao_social",
  "loja_cnpj", "loja_segmento", "loja_canais", "cep", "endereco", "numero", "bairro", "cidade", "uf",
  "cor_primaria", "cor_secundaria", "meta_mensal", "capital_inicial", "salario_desejado", "pct_reinvestir",
  "pct_reserva", "pct_salario", "pct_sonhos", "relampago_horas", "relampago_margem_min", "relampago_descontos",
  "ultimo_mes_dividido"];
const verConfig = () => ({ ...Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, E.config[k]])), modo: banco.modo,
  logo_url: banco.urlFoto(E.config.logo) });

async function salvarConfig(d) {
  const novos = {};
  for (const k of CAMPOS_CONFIG) if (d[k] !== undefined && d[k] !== null && !(typeof d[k] === "number" && isNaN(d[k]))) novos[k] = d[k];
  if ("instagram_arroba" in novos) novos.instagram_arroba = String(novos.instagram_arroba).trim().replace(/^@/, "") || null;
  for (const k of ["whatsapp_loja", "responsavel_whatsapp", "loja_cnpj", "cep"]) if (k in novos) novos[k] = String(novos[k]).replace(/\D/g, "") || null;
  if ("nome_loja" in novos && !String(novos.nome_loja).trim()) falhar("Informe o nome da loja.");
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
    const comId = ["produtos", "despesas", "sonhos"].includes(seg[0]) && seg[1];
    switch (`${m} /${seg[0]}${comId ? "/:id" : ""}${seg[2] ? "/" + seg[2] : ""}`) {
      case "GET /config": return verConfig();
      case "PUT /config": return await salvarConfig(b);
      case "POST /config": return await enviarLogo(b.get("arquivo"));
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
      case "GET /pulso": return pulso();
      case "GET /clientes":
        if (seg[1] === "ranking") return rankingClientes();
        return [...E.clientes].sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => ({ cliente_id: c.id, ...c }));
      case "POST /clientes": return await novoCliente(b);
      case "GET /promocoes": return seg[1] === "divulgacao" ? divulgacao() : pecasEmPromocao();
      case "POST /promocoes": {
        const r = await rodarRobo();
        return { lotes_avaliados: r.lotes_avaliados, novas_ou_atualizadas: r.novas, no_limite_da_margem: r.no_piso,
          encerradas: r.encerradas, postagens: [] };
      }
      case "GET /painel": return painel(q.get("periodo") || "mes");
      case "GET /financas": return financas();
      case "POST /financas": return await dividirMes(b);             // /financas/dividir
      case "POST /despesas": return await salvarDespesa(null, b);
      case "PUT /despesas/:id": return await salvarDespesa(seg[1], b);
      case "DELETE /despesas/:id": await banco.remover("despesas", seg[1]); E.despesas = E.despesas.filter((x) => x.id !== seg[1]); return financas();
      case "POST /sonhos": return await salvarSonho(b);
      case "POST /sonhos/:id/aporte": return await guardarNoSonho(seg[1], b.valor);
      case "DELETE /sonhos/:id": await banco.remover("sonhos", seg[1]); E.sonhos = E.sonhos.filter((x) => x.id !== seg[1]); return financas();
      case "GET /relampago": return sugestaoRelampago();               // /relampago/sugestao
      case "POST /relampago":
        if (seg[1] === "cancelar") return await cancelarRelampago();
        if (seg[1] === "verificar") return { eventos: await verificarRelampago(), relampago: relampagoJson() };
        return await iniciarRelampago(b);
      default: falhar("Função não encontrada: " + url);
    }
  } catch (e) {
    throw new Error(e instanceof ErroApp ? e.message : (e.message || "Erro inesperado"));
  }
}
