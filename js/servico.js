// "Servidor dentro da página": mesmas operações da API Python, agora rodando no aparelho
// e gravando no Supabase (ou no próprio aparelho, no modo demonstração).
import { novoId } from "./banco.js";
import * as R from "./regras.js";
import { gerarFlyer } from "./flyer.js";
import { coresDaLogo } from "./tema.js";
import * as F from "./financas.js";
import * as D from "./demanda.js";
import * as C from "./caixinhas.js";
import * as CFO from "./cfo.js";

const FORMAS = ["pix", "dinheiro", "debito", "credito", "fiado"];
let banco, E;  // E = estado em memória (todas as tabelas)

export async function iniciarServico(b) {
  banco = b;
  E = await banco.carregar();
  if (banco.prepararFotos) await banco.prepararFotos([...E.produtos.map((p) => p.foto), E.config.logo]);
  await migrarCodigosBarras().catch(() => {});
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
/** Peças da variação que estão com clientes no condicional (fora da loja, ainda não vendidas). */
const reservado = (vid, excetoCond = null) => (E.condicionais || []).filter((c) => c.status === "aberta" && c.id !== excetoCond)
  .reduce((s, c) => s + c.itens.filter((i) => i.variacao_id === vid).reduce((t, i) => t + i.quantidade, 0), 0);
const disponivel = (vid, excetoCond = null) => qtdVariacao(vid) - reservado(vid, excetoCond);
const produto = (id) => E.produtos.find((p) => p.id === id) || falhar("Produto não encontrado");
const codigoBase = (p) => (p.etiqueta != null ? String(p.etiqueta) : `${p.categoria}-${String(p.sequencial).padStart(4, "0")}`);
const ativos = () => E.produtos.filter((p) => !p.arquivado);

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
    cor: v.cor, tamanho: v.tamanho, quantidade: qtdVariacao(v.id), reservado: reservado(v.id), disponivel: disponivel(v.id),
    lotes: lotesDe(v.id).filter((l) => l.quantidade_atual > 0).map(loteJson) };
}
function produtoJson(p) {
  const vs = variacoesDe(p.id).sort((a, b) => a.cor.localeCompare(b.cor) || R.chaveTamanho(a.tamanho) - R.chaveTamanho(b.tamanho));
  return { produto_id: p.id, codigo: codigoBase(p), etiqueta: p.etiqueta ?? null, nome: p.nome, foto: banco.urlFoto(p.foto),
    categoria: R.CATEGORIAS[p.categoria] || p.categoria,
    quantidade_total: vs.reduce((s, v) => s + qtdVariacao(v.id), 0), variacoes: vs.map(variacaoJson) };
}
function acharVariacao(codigo) {
  const c = String(codigo).trim().toUpperCase();
  const v = E.variacoes.find((x) => x.codigo === c || x.codigo_barras === c);
  if (v) return v;
  if (/^\d{1,9}$/.test(c)) {   // número da etiqueta (ex.: 5968): se só tem 1 cor/tamanho com estoque, é ela
    const p = ativos().find((x) => x.etiqueta === Number(c));
    if (p) {
      const vs = variacoesDe(p.id).filter((x) => disponivel(x.id) > 0);
      if (vs.length === 1) return vs[0];
      falhar(vs.length ? `A etiqueta ${c} tem ${vs.length} cores/tamanhos. Escolha em + Produtos.` : `A peça ${c} está sem estoque.`);
    }
  }
  falhar(`Peça não encontrada: ${codigo}`);
}

// ---------------------------------------------------------------- etiquetas numeradas (1, 2, 3… ou continuando a da loja)
const maiorEtiqueta = () => Math.max(Number(E.config.etiqueta_ultima) || 0, ...E.produtos.map((p) => p.etiqueta || 0));
function infoEtiquetas() {
  return { ultima: maiorEtiqueta(), proxima: maiorEtiqueta() + 1, definida: !!E.config.etiqueta_definida };
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
  const codigo_barras = p.etiqueta != null ? barrasEtiqueta(p, [...variacoesDe(p.id), ...novasDoProduto]) : R.ean13(numero);
  return { id: novoId(), produto_id: p.id, cor: R.titulo(cor), cor_sigla: sigla, tamanho: tam, numero, codigo, codigo_barras };
}
/** Código de barras das peças com etiqueta numerada: 2 dígitos da cor/tamanho + o número da etiqueta no final.
 *  Ex.: etiqueta 5969 → 015969 (Preto M), 025969 (Preto G). Impresso em Code 128. */
function barrasEtiqueta(p, irmas) {
  const fim = String(p.etiqueta), re = new RegExp(`^(\\d{2})${fim}$`);
  const usados = irmas.map((v) => (re.exec(v.codigo_barras || "") || [])[1]).filter(Boolean).map(Number);
  const idx = Math.max(0, ...usados) + 1;
  if (idx > 99) falhar("Essa peça já tem 99 cores/tamanhos. Cadastre como outro produto.");
  return String(idx).padStart(2, "0") + fim;
}
/** Peças com etiqueta cadastradas antes desta versão ganham o código novo (número da etiqueta no final). */
async function migrarCodigosBarras() {
  for (const p of E.produtos.filter((x) => x.etiqueta != null)) {
    const re = new RegExp(`^\\d{2}${p.etiqueta}$`), vs = variacoesDe(p.id), feitas = vs.filter((v) => re.test(v.codigo_barras));
    for (const v of vs.filter((x) => !re.test(x.codigo_barras))) {
      const cb = barrasEtiqueta(p, feitas); await banco.atualizar("variacoes", v.id, { codigo_barras: cb }); v.codigo_barras = cb; feitas.push(v);
    }
  }
}

function montarLote(v, qtd, custo, preco, data, origem = "compra") {
  if (!(custo > 0)) falhar("Informe o valor pago (custo).");
  if (!(preco > custo)) falhar(`Preço de venda (${R.brl(preco)}) precisa ser maior que o custo (${R.brl(custo)}).`);
  const l = { id: novoId(), variacao_id: v.id, data_entrada: data || R.hojeISO(), quantidade_inicial: qtd,
    quantidade_atual: qtd, custo_unit: custo, preco_venda: preco, preco_promocional: null, desconto_pct: 0,
    promo_no_piso: false, promo_desde: null, origem, registrado_em: new Date().toISOString() };
  const c = R.calcularPromo(l, E.config);  // peça com data antiga já entra com o preço certo
  Object.assign(l, { preco_promocional: c.preco, desconto_pct: c.desconto_pct, promo_no_piso: c.no_piso,
    promo_desde: c.preco ? R.hojeISO() : null });
  return l;
}

async function cadastrarProduto(d) {
  if (!d.nome?.trim()) falhar("Informe o nome da peça.");
  const cat = R.siglaCategoria(d.categoria);
  const seq = Math.max(0, ...E.produtos.filter((p) => p.categoria === cat).map((p) => p.sequencial)) + 1;
  let etiqueta;
  if (d.etiqueta_antiga != null && String(d.etiqueta_antiga).trim() !== "") {   // peça que já tinha etiqueta da loja
    etiqueta = Number(String(d.etiqueta_antiga).replace(/\D/g, ""));
    if (!(etiqueta > 0)) falhar("Digite o número da etiqueta (só números).");
    const dono = E.produtos.find((p) => p.etiqueta === etiqueta);
    if (dono) falhar(`A etiqueta ${etiqueta} já é de "${dono.nome}"${dono.arquivado ? " (apagado, mas com vendas no histórico)" : ""}.`);
  } else etiqueta = maiorEtiqueta() + 1;                                        // peça nova: continua a sequência
  const p = { id: novoId(), categoria: cat, sequencial: seq, etiqueta, arquivado: false, nome: d.nome.trim(), foto: null, criado_em: new Date().toISOString() };
  const vs = [], ls = [];
  for (const g of d.grade) {
    const v = montarVariacao(p, g.cor, g.tamanho, vs); vs.push(v);
    if (g.quantidade > 0) ls.push(montarLote(v, g.quantidade, d.custo, d.preco_venda, d.data_entrada,
      d.etiqueta_antiga != null && String(d.etiqueta_antiga).trim() !== "" ? "inventario" : d.comprou_agora === false ? "inventario" : "compra"));
  }
  await banco.inserir("produtos", [p]); await banco.inserir("variacoes", vs); await banco.inserir("lotes", ls);
  E.produtos.push(p); E.variacoes.push(...vs); E.lotes.push(...ls);
  if (etiqueta > (Number(E.config.etiqueta_ultima) || 0)) E.config = { ...E.config, ...(await banco.salvarConfig({ etiqueta_ultima: etiqueta })) };
  return { ...produtoJson(p), lucro_por_peca: Math.round((d.preco_venda - d.custo) * 100) / 100,
    margem_pct: R.margemPct(d.preco_venda, d.custo) };
}

async function entradaEstoque(d) {
  const v = acharVariacao(d.codigo), ls = lotesDe(v.id);
  const preco = d.preco_venda || ls.at(-1)?.preco_venda || falhar("Informe o preço de venda.");
  const l = montarLote(v, d.quantidade, d.custo, preco, d.data_entrada, d.comprou_agora === false ? "inventario" : "compra");
  await banco.inserir("lotes", [l]); E.lotes.push(l);
  return variacaoJson(v);
}

// ---------------------------------------------------------------- apagar / tirar do estoque
const temVendas = (vids) => E.itens_venda.some((i) => vids.includes(i.variacao_id));
const emCondicional = (vids) => (E.condicionais || []).some((c) => c.status === "aberta" && c.itens.some((i) => vids.includes(i.variacao_id)));
/** Cadastro errado: apaga tudo. Se a peça já tem vendas, some do estoque mas fica no histórico (relatórios não mudam). */
async function apagarProduto(id) {
  const p = produto(id), vids = variacoesDe(p.id).map((v) => v.id);
  if (emCondicional(vids)) falhar("Essa peça está com uma cliente no condicional. Feche o condicional antes de apagar.");
  if (!temVendas(vids)) {
    for (const l of E.lotes.filter((l) => vids.includes(l.variacao_id))) await banco.remover("lotes", l.id);
    for (const v of vids) await banco.remover("variacoes", v);
    await banco.remover("produtos", p.id);
    if (p.foto) await banco.apagarFoto?.(p.foto).catch?.(() => {});
    E.lotes = E.lotes.filter((l) => !vids.includes(l.variacao_id)); E.variacoes = E.variacoes.filter((v) => !vids.includes(v.id));
    E.produtos = E.produtos.filter((x) => x.id !== p.id);
    E.procuras.filter((x) => x.produto_id === p.id).forEach((x) => (x.produto_id = null));
    // era a última etiqueta e foi cadastro errado: o número volta a ficar livre (a sequência não pula)
    if (p.etiqueta != null && p.etiqueta === Number(E.config.etiqueta_ultima)) {
      const volta = Math.max(p.etiqueta - 1, ...E.produtos.map((x) => x.etiqueta || 0));
      E.config = { ...E.config, ...(await banco.salvarConfig({ etiqueta_ultima: volta })) };
    }
    return { apagado: true, historico: false, nome: p.nome };
  }
  for (const l of E.lotes.filter((l) => vids.includes(l.variacao_id) && l.quantidade_atual > 0)) {
    await banco.atualizar("lotes", l.id, { quantidade_atual: 0 }); l.quantidade_atual = 0;
  }
  await banco.atualizar("produtos", p.id, { arquivado: true }); p.arquivado = true;
  return { apagado: true, historico: true, nome: p.nome };
}
/** Tira N peças de uma cor/tamanho (cadastrou a mais, perdeu, estragou). Tira das entradas mais novas primeiro. */
async function tirarDoEstoque(vid, d) {
  const v = E.variacoes.find((x) => x.id === vid) || falhar("Cor/tamanho não encontrado.");
  const livre = disponivel(v.id), qtd = Math.round(Number(d.quantidade));
  if (!(qtd > 0)) falhar("Diga quantas peças tirar.");
  if (qtd > livre) falhar(`Só dá para tirar ${livre}${reservado(v.id) ? " (o resto está em condicional)" : ""}.`);
  let falta = qtd;
  for (const l of lotesDe(v.id).filter((x) => x.quantidade_atual > 0).reverse()) {
    if (!falta) break;
    const q = Math.min(falta, l.quantidade_atual); falta -= q;
    if (l.quantidade_atual - q === 0 && !E.itens_venda.some((i) => i.lote_id === l.id)) {
      await banco.remover("lotes", l.id); E.lotes = E.lotes.filter((x) => x.id !== l.id);
    } else { await banco.atualizar("lotes", l.id, { quantidade_atual: l.quantidade_atual - q }); l.quantidade_atual -= q; }
  }
  // a cor/tamanho ficou vazia e nunca vendeu: some do cadastro também
  let removida = false;
  if (!lotesDe(v.id).length && !temVendas([v.id])) { await banco.remover("variacoes", v.id); E.variacoes = E.variacoes.filter((x) => x.id !== v.id); removida = true; }
  const p = produto(v.produto_id), sobrou = variacoesDe(p.id);
  if (!sobrou.length) { await banco.remover("produtos", p.id); E.produtos = E.produtos.filter((x) => x.id !== p.id); return { tirou: qtd, produto_apagado: true }; }
  return { tirou: qtd, variacao_removida: removida, produto: produtoJson(p) };
}

// ---------------------------------------------------------------- vendas
const METODOS_ENTREGA = { correios: "Correios", transportadora: "Transportadora", motoboy: "Motoboy / app de entrega", outro: "Outro" };

function validarEntrega(e) {
  if (!e) falhar("Preencha os dados de entrega.");
  const dig = (x) => String(x || "").replace(/\D/g, "");
  const brasil = !e.pais || /^bra[sz]il$/i.test(e.pais.trim());
  const faltando = [];
  if (!e.nome?.trim()) faltando.push("nome de quem recebe");
  if (dig(e.telefone).length < 10) faltando.push("celular com DDD");
  if (!e.endereco?.trim()) faltando.push("rua / endereço");
  if (!e.numero?.trim()) faltando.push("número");
  if (!e.cidade?.trim()) faltando.push("cidade");
  if (brasil) {
    if (dig(e.cep).length !== 8) faltando.push("CEP");
    if (!/^[A-Za-z]{2}$/.test(e.uf || "")) faltando.push("estado (UF)");
  }
  if (faltando.length) falhar("Venda online: falta " + faltando.join(", ") + ".");
  const rastreio = String(e.rastreio || "").trim().toUpperCase();
  return { metodo: METODOS_ENTREGA[e.metodo] ? e.metodo : "correios", nome: e.nome.trim(), telefone: dig(e.telefone),
    pais: brasil ? "Brasil" : e.pais.trim(), cep: dig(e.cep), endereco: e.endereco.trim(), numero: e.numero.trim(),
    complemento: e.complemento?.trim() || "", bairro: e.bairro?.trim() || "", cidade: e.cidade.trim(),
    uf: brasil ? e.uf.toUpperCase() : (e.uf || "").trim(), rastreio, status: rastreio ? "enviado" : "aguardando_envio",
    enviado_em: rastreio ? new Date().toISOString() : null };
}

async function vender(d, { condicional = null } = {}) {
  if (!FORMAS.includes(d.forma_pagamento)) falhar("Forma de pagamento inválida.");
  if (!d.itens?.length) falhar("Adicione pelo menos uma peça.");
  const canal = d.canal === "online" ? "online" : "loja";
  const entrega = canal === "online" ? validarEntrega(d.entrega) : null;
  const itens = d.itens.map((it) => {
    const v = it.variacao_id ? E.variacoes.find((x) => x.id === it.variacao_id) : acharVariacao(it.codigo);
    const livre = disponivel(v.id, condicional);
    if (livre < it.quantidade) falhar(`${v.codigo}: só tem ${livre} disponível${reservado(v.id, condicional) ? " (o resto está em condicional)" : ""}.`);
    return { variacao_id: v.id, quantidade: it.quantidade, codigo: v.codigo };
  });
  const acrescimo = Math.round(Math.max(0, Number(d.acrescimo) || 0) * 100) / 100;
  const parcelas = d.forma_pagamento === "credito" ? Math.min(24, Math.max(1, Math.round(Number(d.parcelas) || 1))) : 1;
  const taxaPct = R.taxaDaVenda(E.config, d.forma_pagamento, parcelas);
  await verificarRelampago();
  const id = novoId();
  const r = await banco.registrarVenda({ id, forma: d.forma_pagamento, clienteId: d.cliente_id || null,
    desconto: d.desconto_extra || 0, itens, canal, entrega, condicional, acrescimo, parcelas, taxaPct });
  E = await banco.carregar();  // recarrega estoque e vendas como ficaram no banco
  if (banco.prepararFotos) await banco.prepararFotos([...E.produtos.map((p) => p.foto), E.config.logo]);
  const ev = await verificarRelampago();  // a peça relâmpago pode ter sido vendida agora
  const lucro = Math.round((r.total - r.custo - r.taxa_maquininha) * 100) / 100;
  return { ...r, lucro, parcelas, taxa_pct: taxaPct, acrescimo, alerta: lucro < 0 ? "Atenção: essa venda deu prejuízo." : null, relampago: ev,
    entrega: entrega ? entregaJson(E.vendas.find((v) => v.id === id)) : null };
}
const registrarVenda = (d) => vender(d);

// ---------------------------------------------------------------- entregas (vendas online)
const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
function itensDaVenda(vendaId) {
  return E.itens_venda.filter((i) => i.venda_id === vendaId).map((i) => {
    const v = E.variacoes.find((x) => x.id === i.variacao_id), p = v && E.produtos.find((x) => x.id === v.produto_id);
    return `${i.quantidade}x ${p?.nome || "peça"}${v ? ` ${v.cor} ${v.tamanho}` : ""}`;
  });
}
function enderecoTexto(e) {
  return `${e.endereco}, ${e.numero}${e.complemento ? " – " + e.complemento : ""}${e.bairro ? ", " + e.bairro : ""}, ${e.cidade}${e.uf ? "/" + e.uf : ""}` +
    `${e.cep ? ", CEP " + e.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : ""}${e.pais && e.pais !== "Brasil" ? ", " + e.pais : ""}`;
}
function mensagemEntrega(v) {
  const e = v.entrega, loja = E.config.nome_loja, itens = itensDaVenda(v.id).map((t) => "• " + t).join("\n");
  if (!e.rastreio) return `Oi, ${primeiroNome(e.nome)}! 💖 Aqui é da ${loja}. Recebemos seu pedido:\n${itens}\n\nVai para: ${enderecoTexto(e)}\n\n` +
    "Assim que postarmos, te mandamos o código de rastreio. Obrigada pela compra! ✨";
  const link = e.metodo === "correios" ? `\nAcompanhe aqui: https://rastreamento.correios.com.br/app/index.php (cole o código)` : "";
  return `Oi, ${primeiroNome(e.nome)}! 💖 Aqui é da ${loja}. Seu pedido foi enviado! 📦\n\n${itens}\n\nEnvio: ${METODOS_ENTREGA[e.metodo]}\n` +
    `Código de rastreio: *${e.rastreio}*${link}\n\nEntrega em: ${enderecoTexto(e)}\n\nQualquer dúvida é só chamar. Obrigada pela compra! ✨`;
}
function entregaJson(v) {
  const e = v.entrega;
  return { venda_id: v.id, data: v.data, total: v.total, ...e, metodo_nome: METODOS_ENTREGA[e.metodo], endereco_completo: enderecoTexto(e),
    itens: itensDaVenda(v.id), mensagem: mensagemEntrega(v),
    rastreio_valido: !e.rastreio || e.metodo !== "correios" || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(e.rastreio) };
}
function listarEntregas() {
  const ordem = { aguardando_envio: 0, enviado: 1, entregue: 2 };
  return E.vendas.filter((v) => v.canal === "online" && v.entrega).map(entregaJson)
    .sort((a, b) => (ordem[a.status] - ordem[b.status]) || String(b.data).localeCompare(String(a.data)));
}
async function atualizarEntrega(vendaId, d) {
  const v = E.vendas.find((x) => x.id === vendaId && x.entrega) || falhar("Venda online não encontrada.");
  const e = { ...v.entrega };
  if (d.rastreio !== undefined) {
    e.rastreio = String(d.rastreio || "").trim().toUpperCase();
    if (!e.rastreio) falhar("Informe o código de rastreio.");
    e.status = "enviado"; e.enviado_em = e.enviado_em || new Date().toISOString();
  }
  if (d.metodo && METODOS_ENTREGA[d.metodo]) e.metodo = d.metodo;
  if (d.status === "entregue") { e.status = "entregue"; e.entregue_em = new Date().toISOString(); }
  await banco.atualizar("vendas", vendaId, { entrega: e }); v.entrega = e;
  return entregaJson(v);
}

// ---------------------------------------------------------------- condicional
function dataBR(iso) { const [a, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}`; }
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function condicionalJson(c) {
  const cli = E.clientes.find((x) => x.id === c.cliente_id) || {};
  const total = Math.round(c.itens.reduce((s, i) => s + i.quantidade * i.preco, 0) * 100) / 100;
  const atraso = c.status === "aberta" ? R.diasEntre(c.prazo) : 0;
  const lista = c.itens.map((i) => `• ${i.quantidade}x ${i.nome} ${i.cor} ${i.tamanho} – ${R.brl(i.preco)}`).join("\n");
  const dia = DIAS_SEMANA[new Date(c.prazo + "T12:00").getDay()];
  const msgSaida = `Oi, ${primeiroNome(cli.nome)}! 💖 Separei para você levar no condicional:\n${lista}\n\nTotal: ${R.brl(total)}\n` +
    `Devolução até ${dataBR(c.prazo)} (${dia}). O que ficar com você, a gente acerta na volta. 😊\n${E.config.nome_loja}`;
  const msgLembrete = `Oi, ${primeiroNome(cli.nome)}! Tudo bem? 💖 Passando para lembrar do condicional que você levou da ${E.config.nome_loja}` +
    ` (devolução ${atraso > 0 ? "era" : "é"} até ${dataBR(c.prazo)}):\n${lista}\n\nGostou de alguma? Me avisa que eu já separo! 😊`;
  return { ...c, cliente: cli.nome, whatsapp: cli.whatsapp, total, pecas: c.itens.reduce((s, i) => s + i.quantidade, 0),
    atrasada: atraso > 0, dias_atraso: Math.max(0, atraso), vence_hoje: atraso === 0 && c.status === "aberta",
    mensagem_saida: msgSaida, mensagem_lembrete: msgLembrete };
}
async function criarCondicional(d) {
  const cli = E.clientes.find((x) => x.id === d.cliente_id) || falhar("Escolha a cliente do condicional.");
  if (!d.itens?.length) falhar("Adicione as peças que a cliente vai levar.");
  const itens = d.itens.map((it) => {
    const v = acharVariacao(it.codigo), p = E.produtos.find((x) => x.id === v.produto_id);
    if (disponivel(v.id) < it.quantidade) falhar(`${v.codigo}: só tem ${disponivel(v.id)} disponível.`);
    const l = lotesDe(v.id).find((x) => x.quantidade_atual > 0);
    return { variacao_id: v.id, codigo: v.codigo, nome: p.nome, cor: v.cor, tamanho: v.tamanho, quantidade: it.quantidade, preco: R.precoAtual(l) };
  });
  const prazo = new Date(); prazo.setDate(prazo.getDate() + (Number(d.prazo_dias) || 3));
  const c = { id: novoId(), cliente_id: cli.id, data: new Date().toISOString(), prazo: R.hojeISO(prazo), itens, status: "aberta",
    fechada_em: null, venda_id: null, obs: d.obs || null };
  await banco.inserir("condicionais", [c]); E.condicionais.push(c);
  return condicionalJson(c);
}
function listarCondicionais() {
  return E.condicionais.map(condicionalJson).sort((a, b) => (a.status !== "aberta") - (b.status !== "aberta") ||
    (a.status === "aberta" ? a.prazo.localeCompare(b.prazo) : String(b.fechada_em).localeCompare(String(a.fechada_em)))).slice(0, 40);
}
async function fecharCondicional(id, d) {
  const c = E.condicionais.find((x) => x.id === id && x.status === "aberta") || falhar("Condicional não encontrado ou já fechado.");
  const ficou = (d.ficou || []).filter((x) => x.quantidade > 0);
  for (const f of ficou) {
    const it = c.itens.find((i) => i.variacao_id === f.variacao_id);
    if (!it || f.quantidade > it.quantidade) falhar("Quantidade maior do que a cliente levou.");
  }
  let venda = null;
  if (ficou.length) venda = await vender({ forma_pagamento: d.forma_pagamento || "pix", cliente_id: c.cliente_id, desconto_extra: d.desconto_extra || 0,
    itens: ficou.map((f) => ({ variacao_id: f.variacao_id, quantidade: f.quantidade })) }, { condicional: c.id });
  const campos = { status: "fechada", fechada_em: new Date().toISOString(), venda_id: venda?.venda_id || null };
  const atual = E.condicionais.find((x) => x.id === id);  // E pode ter sido recarregado pela venda
  await banco.atualizar("condicionais", id, campos); Object.assign(atual, campos);
  return { condicional: condicionalJson(atual), venda };
}
async function cancelarCondicional(id) {
  const c = E.condicionais.find((x) => x.id === id && x.status === "aberta") || falhar("Condicional não encontrado.");
  const campos = { status: "cancelada", fechada_em: new Date().toISOString() };
  await banco.atualizar("condicionais", id, campos); Object.assign(c, campos);
  return condicionalJson(c);
}

// ---------------------------------------------------------------- ciclo da demanda: procuras → compras → avisar
function precoMedioCat() {
  const m = {};
  for (const l of E.lotes) { const v = E.variacoes.find((x) => x.id === l.variacao_id), p = v && E.produtos.find((x) => x.id === v.produto_id); if (!p) continue;
    const g = m[p.categoria] ||= [0, 0]; g[0] += l.preco_venda; g[1]++; }
  return Object.fromEntries(Object.entries(m).map(([k, [s, n]]) => [k, Math.round(s / n * 100) / 100]));
}
function procuraJson(p) {
  const cli = p.cliente_id ? E.clientes.find((c) => c.id === p.cliente_id) : null;
  return { ...p, nome: cli?.nome || p.nome, whatsapp: cli?.whatsapp || p.whatsapp, nome_cat: R.CATEGORIAS[p.categoria] || p.descricao || "Peça" };
}
async function registrarProcura(d) {
  const categoria = d.categoria ? R.siglaCategoria(d.categoria) : null;
  if (!categoria && !d.descricao?.trim()) falhar("Diga o que a cliente procurou (tipo de peça ou descrição).");
  const p = { id: novoId(), data: new Date().toISOString(), categoria, descricao: d.descricao?.trim() || null,
    cor: d.cor ? R.titulo(d.cor) : null, tamanho: d.tamanho ? R.normalizaTamanho(d.tamanho) : null,
    cliente_id: d.cliente_id || null, nome: d.nome?.trim() || null, whatsapp: String(d.whatsapp || "").replace(/\D/g, "") || null,
    status: "aberta", avisada_em: null, produto_id: null };
  await banco.inserir("procuras", [p]); E.procuras.push(p);
  return procuraJson(p);
}
function radarDemanda() {
  const r = D.radar(E.procuras, { precoMedioCat: precoMedioCat(), nomesCat: R.CATEGORIAS });
  return { ...r, recentes: E.procuras.filter((p) => p.status === "aberta").sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 10).map(procuraJson) };
}
function compraInteligente(orcamento) {
  const agora = Date.now(), lim = agora - 60 * 864e5;
  const idsVendas = new Set(E.vendas.filter((v) => new Date(v.data).getTime() >= lim).map((v) => v.id));
  const vendidos = E.itens_venda.filter((i) => idsVendas.has(i.venda_id)).map((i) => {
    const v = E.variacoes.find((x) => x.id === i.variacao_id), p = v && E.produtos.find((x) => x.id === v.produto_id);
    return p ? { categoria: p.categoria, tamanho: v.tamanho, cor: v.cor, qtd: i.quantidade } : null; }).filter(Boolean);
  const estoque = E.lotes.filter((l) => l.quantidade_atual > 0).map((l) => {
    const v = E.variacoes.find((x) => x.id === l.variacao_id), p = E.produtos.find((x) => x.id === v.produto_id);
    return { categoria: p.categoria, tamanho: v.tamanho, cor: v.cor, disponivel: Math.max(0, Math.min(l.quantidade_atual, disponivel(v.id))),
      dias: R.diasEntre(l.data_entrada), custo: l.custo_unit, preco: l.preco_venda }; });
  const procuras = E.procuras.filter((p) => p.status === "aberta" && new Date(p.data).getTime() >= lim);
  const escada = R.lerEscada(E.config.escada_promocao);
  const base = { vendidos, estoque, procuras, nomesCat: R.CATEGORIAS, diasAlerta: escada.length ? escada[0][0] : 35 };
  // sugestão: o que cobre toda a necessidade de 30 dias (arredondado para cima de 50 em 50)
  const tudo = D.listaCompras({ ...base, orcamento: 1e9 }).gasto;
  const sugerido = Math.ceil(tudo / 50) * 50;
  const v = financas().cfo.verba;
  const verba = v.sem_dados ? null : v.pode_comprar;
  const orc = Number(orcamento) > 0 ? Number(orcamento) : (verba > 0 ? verba : (sugerido || 500));
  return { ...D.listaCompras({ ...base, orcamento: orc }), orcamento_sugerido: sugerido, verba: v.sem_dados ? null : v };
}
function perfisClientes() {
  const m = new Map();
  for (const v of E.vendas) if (v.cliente_id) {
    const c = m.get(v.cliente_id) || { tamanhos: {}, categorias: {}, total: 0, ultima: v.data };
    c.total += v.total; if (v.data > c.ultima) c.ultima = v.data;
    for (const i of E.itens_venda.filter((x) => x.venda_id === v.id)) {
      const va = E.variacoes.find((x) => x.id === i.variacao_id), p = va && E.produtos.find((x) => x.id === va.produto_id);
      if (!p) continue; c.tamanhos[va.tamanho] = (c.tamanhos[va.tamanho] || 0) + i.quantidade; c.categorias[p.categoria] = (c.categorias[p.categoria] || 0) + i.quantidade;
    }
    m.set(v.cliente_id, c);
  }
  return E.clientes.map((c) => ({ cliente_id: c.id, nome: c.nome, whatsapp: c.whatsapp, ...(m.get(c.id) || { tamanhos: {}, categorias: {}, total: 0, ultima: null }) }));
}
function quemAvisar(produtoId) {
  const p = produto(produtoId);
  const vs = variacoesDe(p.id).map((v) => ({ ...v, disponivel: disponivel(v.id), preco: R.precoAtual(lotesDe(v.id).find((l) => l.quantidade_atual > 0) || { preco_venda: 0 }) }));
  const preco = Math.min(...vs.filter((v) => v.disponivel > 0).map((v) => v.preco).concat([Infinity]));
  if (!isFinite(preco)) return { produto: p.nome, procuras: [], clientes: [] };
  const atend = D.procurasAtendidas(E.procuras.filter((x) => x.cliente_id || x.nome || x.whatsapp), p, vs).map(({ procura, variacao }) => {
    const pj = procuraJson(procura);
    return { id: procura.id, nome: pj.nome, whatsapp: pj.whatsapp, pediu: [pj.nome_cat, procura.cor, procura.tamanho].filter(Boolean).join(" "),
      dias: R.diasEntre(R.hojeISO(new Date(procura.data))),
      mensagem: D.msgProcura(pj, p, variacao, variacao.preco, E.config.nome_loja, R.CATEGORIAS[p.categoria]) };
  });
  const jaAvisar = new Set(atend.map((a) => a.whatsapp).filter(Boolean));
  const cores = [...new Set(vs.filter((v) => v.disponivel > 0).map((v) => v.cor))];
  const clientes = D.clientesParaNovidade(perfisClientes(), p, vs).filter((c) => !jaAvisar.has(c.whatsapp))
    .map((c) => ({ ...c, mensagem: D.msgNovidade(c, p, cores, preco, E.config.nome_loja) }));
  return { produto: p.nome, foto: banco.urlFoto(p.foto), procuras: atend, clientes };
}
async function marcarProcura(id, status) {
  const p = E.procuras.find((x) => x.id === id) || falhar("Procura não encontrada");
  const campos = { status, avisada_em: status === "avisada" ? new Date().toISOString() : p.avisada_em };
  await banco.atualizar("procuras", id, campos); Object.assign(p, campos);
  return procuraJson(p);
}

// ---------------------------------------------------------------- busca de produtos (vender sem leitor)
function buscarPecas(q) {
  const t = R.semAcento(String(q || "")).toLowerCase().trim().split(/\s+/).filter(Boolean);
  return ativos().map((p) => {
    const vs = variacoesDe(p.id).map((v) => {
      const l = lotesDe(v.id).find((x) => x.quantidade_atual > 0);
      return { codigo: v.codigo, codigo_barras: v.codigo_barras, cor: v.cor, tamanho: v.tamanho, disponivel: disponivel(v.id), reservado: reservado(v.id),
        preco: l ? R.precoAtual(l) : null, promo: l?.preco_promocional != null,
        busca: R.semAcento(`${p.nome} ${v.cor} ${v.tamanho} ${v.codigo} ${v.codigo_barras} ${R.CATEGORIAS[p.categoria] || ""}`).toLowerCase() };
    }).filter((v) => t.every((w) => v.busca.includes(w)))
      .sort((a, b) => a.cor.localeCompare(b.cor) || R.chaveTamanho(a.tamanho) - R.chaveTamanho(b.tamanho));
    return { produto_id: p.id, nome: p.nome, codigo: codigoBase(p), foto: banco.urlFoto(p.foto), variacoes: vs.map(({ busca, ...x }) => x),
      disponivel: vs.reduce((s, v) => s + v.disponivel, 0) };
  }).filter((p) => p.variacoes.length).sort((a, b) => (b.disponivel > 0) - (a.disponivel > 0) || a.nome.localeCompare(b.nome)).slice(0, 40);
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
  // dias úteis (sábado meio período, feriado fechado não conta)
  const calP = calendario(), hojeP = R.hojeISO(), iniP = C.iso(iniMes), fimP = C.iso(fimMes);
  const diasRestantes = calP.uteis(hojeP, fimP), uteisPassados = calP.uteis(iniP, C.somaDias(hojeP, 1)), uteisMesP = calP.uteis(iniP, fimP);
  const meta = cfg.meta_mensal > 0 ? { valor: cfg.meta_mensal, vendido: vendidoMes, pct: Math.round(vendidoMes / cfg.meta_mensal * 1000) / 10,
    falta: r2(Math.max(0, cfg.meta_mensal - vendidoMes)), dias_restantes: diasRestantes,
    por_dia: r2(Math.max(0, cfg.meta_mensal - vendidoMes) / Math.max(0.5, diasRestantes)),
    ritmo: r2(uteisPassados > 0 ? vendidoMes / uteisPassados * uteisMesP : vendidoMes) } : null;

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

  // de onde vêm as vendas: loja x online, e online por estado
  const origem = { loja: { vendas: 0, total: 0 }, online: { vendas: 0, total: 0 }, por_uf: {}, exterior: { vendas: 0, total: 0 }, cidades: {} };
  for (const v of vendas) {
    const k = v.canal === "online" ? "online" : "loja";
    origem[k].vendas++; origem[k].total = r2(origem[k].total + v.total);
    if (k === "online" && v.entrega) {
      if (v.entrega.pais && v.entrega.pais !== "Brasil") { origem.exterior.vendas++; origem.exterior.total = r2(origem.exterior.total + v.total); }
      else {
        const u = (v.entrega.uf || "").toUpperCase(); if (!u) continue;
        const g = origem.por_uf[u] || { vendas: 0, total: 0 }; g.vendas++; g.total = r2(g.total + v.total); origem.por_uf[u] = g;
        const c = `${v.entrega.cidade}/${u}`; origem.cidades[c] = (origem.cidades[c] || 0) + 1;
      }
    }
  }
  origem.top_cidades = Object.entries(origem.cidades).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ cidade: c, vendas: n }));
  delete origem.cidades;

  return {
    periodo, comparado_com: I.rotulo, atual, comparacao: comp, serie, formas, vs_meta: vsMeta, spark, origem,
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

// ---------------------------------------------------------------- calendário e caixinhas
const calendario = () => C.criarCalendario(E.config);
function diarioLucro() {
  const d = {};
  for (const v of E.vendas) {
    const k = C.iso(new Date(v.data)), x = d[k] ||= { lucro: 0, vendas: 0, custo: 0, taxa: 0 };
    x.lucro += v.total - v.custo_total - v.taxa_pagamento; x.vendas += v.total; x.custo += v.custo_total; x.taxa += v.taxa_pagamento;
  }
  return d;
}
const salarioDoMes = (mes) => { const m = E.config.salario_meses || {}; return m[mes] != null ? Number(m[mes]) : Number(E.config.salario_desejado) || 0; };
function sonhosPorMes() {
  const hoje = R.hojeISO();
  return E.sonhos.filter((x) => !x.concluido && x.prazo).reduce((t, x) => t + Math.max(0, x.valor - (x.guardado || 0)) / F.mesesEntre(hoje, x.prazo), 0);
}
function obrigacoes() {
  const ob = [...E.despesas].sort((a, b) => (a.ordem - b.ordem) || String(a.criado_em).localeCompare(String(b.criado_em)))
    .map((d) => ({ id: d.id, nome: d.nome, tipo: "conta", dia: Number(d.vencimento) || null, valor: () => F.previsaoDespesa(d).valor }));
  if (salarioDoMes(R.hojeISO().slice(0, 7)) > 0 || Object.keys(E.config.salario_meses || {}).length)
    ob.push({ id: "salario", nome: "Seu salário", tipo: "salario", valor: (ini) => salarioDoMes(ini.slice(0, 7)) });
  const sm = sonhosPorMes();
  if (sm > 0) ob.push({ id: "sonhos", nome: "Sonhos", tipo: "sonhos", valor: () => sm });
  return ob;
}
let cacheCx = null;
function caixinhas() {
  const hoje = R.hojeISO(), chave = `${hoje}|${E.vendas.length}|${JSON.stringify(E.despesas.map((d) => [d.id, d.valor, d.valores, d.vencimento]))}|${E.config.salario_desejado}|${JSON.stringify(E.config.salario_meses)}|${E.config.horario}|${E.config.abre_feriado}|${E.config.feriados_extra}|${E.sonhos.map((x) => x.guardado + x.prazo).join()}|${E.config.cofre_inicio}`;
  if (cacheCx?.chave === chave) return cacheCx.r;
  const cal = calendario(), d0 = C.dataDe(hoje);
  let inicio = C.iso(new Date(d0.getFullYear(), d0.getMonth() - 2, 1));
  const ci = E.config.cofre_inicio ? C.iso(new Date(E.config.cofre_inicio)) : null;
  if (ci && ci < inicio) inicio = [ci.slice(0, 8) + "01", C.iso(new Date(d0.getFullYear() - 1, d0.getMonth(), 1))].sort().pop();
  const diario = diarioLucro(), ob = obrigacoes();
  const sim = ob.length ? C.simularCaixinhas({ obrigacoes: ob, diario, cal, inicio, hoje, socorro: ci ? ["sonhos"] : ["sonhos", "salario"] })
    : { caixinhas: [], historico: [], movimentos: [], dias: {} };
  cacheCx = { chave, r: { sim, cal, diario, hoje } };
  return cacheCx.r;
}

// ---------------------------------------------------------------- diretor financeiro (cofre, compras, metas, saúde)
const comprasDoCofre = () => E.lotes.filter((l) => l.origem === "compra").map((l) => {
  const v = E.variacoes.find((x) => x.id === l.variacao_id), p = v && E.produtos.find((x) => x.id === v.produto_id);
  return { data: C.iso(new Date(l.registrado_em || l.data_entrada + "T12:00:00")), valor: Math.round(l.custo_unit * l.quantidade_inicial * 100) / 100,
    descricao: `Compra: ${l.quantidade_inicial}x ${p ? p.nome : "peça"}${v ? " " + v.cor + " " + v.tamanho : ""}` };
});
function estadoCofreAgora(sim, diario, contasMes) {
  if (!E.config.cofre_inicio) return null;
  const metaReserva = Math.round(contasMes * (Number(E.config.reserva_meses) || 2) * 100) / 100;
  const st = CFO.estadoCofre({ inicio: C.iso(new Date(E.config.cofre_inicio)), hoje: R.hojeISO(), movs: E.cofre || [], diario, dias: sim.dias,
    historico: sim.historico, compras: comprasDoCofre(), metaReserva });
  return { ...st, meta_reserva: metaReserva, meses_reserva: contasMes > 0 ? Math.round(st.reserva / contasMes * 10) / 10 : null, inicio: E.config.cofre_inicio };
}
function estoqueACusto() {
  const dAlerta = (R.lerEscada(E.config.escada_promocao)[0] || [35])[0];
  let custo = 0, parado = 0, paradoVenda = 0, pecas = 0, pecasParadas = 0;
  for (const l of E.lotes.filter((x) => x.quantidade_atual > 0)) {
    const c = l.custo_unit * l.quantidade_atual; custo += c; pecas += l.quantidade_atual;
    if (R.diasEntre(l.data_entrada) >= dAlerta) { parado += c; paradoVenda += R.precoAtual(l) * l.quantidade_atual; pecasParadas += l.quantidade_atual; }
  }
  return { custo, parado, paradoVenda, pecas, pecasParadas, dias_alerta: dAlerta };
}
function diretorFinanceiro({ cal, diario, hojeS, calMes, tot, margem, salario, sonhosMes, cofre, alertas, vMesTotal }) {
  const est = estoqueACusto();
  // ritmo das últimas 8 semanas (por dia útil)
  const de = C.somaDias(hojeS, -56); let cmv = 0, vendas = 0;
  for (let x = de; x < hojeS; x = C.somaDias(x, 1)) { cmv += diario[x]?.custo || 0; vendas += diario[x]?.vendas || 0; }
  const uteis56 = cal.uteis(de, hojeS), temVendas = vendas > 0 && uteis56 >= 4;
  const cmvDiaUtil = temVendas ? cmv / uteis56 : 0, vendaDiaUtil = temVendas ? vendas / uteis56 : 0;
  const m0 = +hojeS.slice(5, 7), m1 = m0 % 12 + 1, ratio = C.SAZONAL_MODA[m1] / C.SAZONAL_MODA[m0];
  const fator = Math.round(Math.min(1.5, Math.max(0.8, (1 + ratio) / 2)) * 100) / 100;
  const lucroPrevisto = salario.este.projecao_lucro, buraco = temVendas ? tot.mensal + salario.valor - lucroPrevisto : 0;
  const verba = CFO.verbaCompras({ cmvDiaUtil, uteis30: cal.uteis(hojeS, C.somaDias(hojeS, 30)), fatorSazonal: fator, estoqueCusto: est.custo,
    paradoCusto: est.parado, coberturaDias: Number(E.config.cobertura_dias) || 60, giro: cofre?.giro || 0, temCofre: !!cofre, apertado: buraco });
  const metas = CFO.metasMes({ minhaMeta: Number(E.config.meta_mensal) || 0, contasMes: tot.mensal, salario: salario.valor, sonhos: sonhosMes, margem,
    faltaReserva: cofre ? cofre.meta_reserva - cofre.reserva : 0, uteisMes: calMes.uteis, uteisRestam: calMes.restam, vendidoMes: vMesTotal, vendaDiaUtil });
  const plano = temVendas ? CFO.planoMesApertado({ buraco, sonhosMes, reserva: cofre?.reserva || 0,
    paradoCusto: est.parado, paradoVenda: est.paradoVenda, giro: cofre?.giro || 0, verbaCompra: verba.verba || 0, salario: salario.valor }) : null;
  const sd = CFO.saude({ reservaMeses: cofre?.meses_reserva || 0, metaReservaMeses: Number(E.config.reserva_meses) || 2,
    cobertura: verba.sem_dados ? null : verba.cobertura_dias, coberturaAlvo: Number(E.config.cobertura_dias) || 60,
    pctParado: est.custo > 0 ? est.parado / est.custo * 100 : 0, margem, previsaoVsMinima: metas.metas[0].valor > 0 ? metas.previsao / metas.metas[0].valor : null,
    temVendas, temCofre: !!cofre });
  // o que fazer agora (mais urgente primeiro)
  const rec = [];
  for (const a of alertas) rec.push({ nivel: a.nivel === "perigo" ? 3 : 2, icone: "🏠", texto: `${a.conta} vence em ${a.dias_ate} dia(s) e pode faltar ${R.brl(a.falta_prevista)}. Veja as caixinhas.` });
  if (plano) rec.push({ nivel: 3, icone: "🧯", texto: `No ritmo atual o mês fecha faltando ${R.brl(plano.buraco)} para contas e salário. Siga o plano abaixo.` });
  if (!cofre) rec.push({ nivel: 2, icone: "🏦", texto: "Abra o cofre: diga quanto dinheiro a loja tem hoje e o app separa a reserva e o dinheiro de compras." });
  for (const i of sd.indicadores) if (i.dica) rec.push({ nivel: i.nota < 40 ? 3 : 2, icone: { reserva: "🛟", margem: "🏷️", cobertura: "🧺", parado: "🔥", ritmo: "📉" }[i.id], texto: i.dica });
  if (!verba.sem_dados && verba.situacao.nivel !== "ok") rec.push({ nivel: 2, icone: "🛍️", texto: verba.situacao.texto });
  if (metas.conselho) rec.push({ nivel: 1, icone: "🎯", texto: metas.conselho });
  if (!rec.length) rec.push({ nivel: 0, icone: "✅", texto: "Empresa saudável. Continue separando as caixinhas e comprando pela verba." });
  rec.sort((a, b) => b.nivel - a.nivel);
  return { cofre, verba, metas, plano, saude: sd, recomendacoes: rec.slice(0, 5), estoque: { custo: Math.round(est.custo * 100) / 100, parado: Math.round(est.parado * 100) / 100,
    pecas: est.pecas, pecas_paradas: est.pecasParadas, dias_alerta: est.dias_alerta }, ritmo: { venda_dia_util: Math.round(vendaDiaUtil * 100) / 100, cmv_dia_util: Math.round(cmvDiaUtil * 100) / 100 },
    capital_total: cofre ? Math.round((Math.max(0, cofre.reserva) + Math.max(0, cofre.giro) + est.custo) * 100) / 100 : null,
    reserva_meses_meta: Number(E.config.reserva_meses) || 2, cobertura_meta: Number(E.config.cobertura_dias) || 60 };
}
async function iniciarCofre(d) {
  const dinheiro = Number(d.dinheiro); if (!(dinheiro >= 0)) falhar("Diga quanto dinheiro a loja tem hoje.");
  if (E.config.cofre_inicio) falhar("O cofre já está aberto. Use Colocar / Tirar / Corrigir saldo.");
  const tot = F.totalDespesas(E.despesas), div = CFO.dividirInicio(dinheiro, tot.mensal, Number(E.config.reserva_meses) || 2);
  const agora = new Date().toISOString();
  const movs = [{ id: novoId(), data: agora, bolso: "reserva", valor: div.reserva, tipo: "inicio", descricao: "Abertura do cofre: reserva" },
    { id: novoId(), data: agora, bolso: "giro", valor: div.giro, tipo: "inicio", descricao: "Abertura do cofre: dinheiro de compras" }];
  await banco.inserir("cofre", movs); (E.cofre ||= []).push(...movs);
  E.config = { ...E.config, ...(await banco.salvarConfig({ cofre_inicio: agora })) };
  return financas();
}
async function movimentarCofre(d) {
  if (!E.config.cofre_inicio) falhar("Abra o cofre primeiro.");
  const bolso = d.bolso === "giro" ? "giro" : "reserva", tipo = ["entrada", "retirada", "ajuste"].includes(d.tipo) ? d.tipo : "entrada";
  let valor = Math.round(Number(d.valor) * 100) / 100;
  if (!(valor >= 0) || (tipo !== "ajuste" && !(valor > 0))) falhar("Valor inválido.");
  if (tipo === "retirada") valor = -valor;
  const nome = bolso === "reserva" ? "reserva" : "dinheiro de compras";
  const m = { id: novoId(), data: new Date().toISOString(), bolso, valor, tipo,
    descricao: d.descricao?.trim() || (tipo === "ajuste" ? `Saldo corrigido (${nome})` : tipo === "entrada" ? `Colocou na ${nome}` : `Tirou da ${nome}`) };
  await banco.inserir("cofre", [m]); (E.cofre ||= []).push(m);
  return financas();
}

/** Contas "vencidas" até hoje no mês, proporcionais aos dias úteis já passados (inclui hoje). */
function calMesSafe(mensal, cal, ini, fim, hoje) {
  const u = cal.uteis(ini, fim); return u > 0 ? mensal * cal.uteis(ini, C.somaDias(hoje, 1)) / u : 0;
}
function financas() {
  const cfg = E.config, agora = new Date(), hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const despesas = [...E.despesas].sort((a, b) => (a.ordem - b.ordem) || String(a.criado_em).localeCompare(String(b.criado_em)));
  const tot = F.totalDespesas(despesas);
  const ultimos90 = vendasEntre(new Date(hoje.getTime() - 90 * 864e5), new Date(hoje.getTime() + 864e5));
  const { margem, fonte } = F.margemBruta(ultimos90, E.lotes);

  // calendário do mês (dias úteis com peso: sábado meio período, feriado fechado = 0)
  const { sim, cal, diario } = caixinhas(), hojeS = R.hojeISO();
  const iniMesS = hojeS.slice(0, 8) + "01", fimMesS = C.iso(new Date(agora.getFullYear(), agora.getMonth() + 1, 1));
  const infoHoje = cal.info(hojeS);
  const calMes = { uteis: cal.uteis(iniMesS, fimMesS), passados: cal.uteis(iniMesS, hojeS), restam: cal.uteis(hojeS, fimMesS),
    feriados: cal.feriadosEntre(iniMesS, fimMesS), hoje: infoHoje };
  const contasPorDiaUtil = calMes.uteis > 0 ? Math.round(tot.mensal / calMes.uteis * 100) / 100 : tot.diario;

  // hoje: quanto cada caixinha precisa receber hoje e para onde foi o lucro do dia
  const vHoje = vendasEntre(hoje, new Date(hoje.getTime() + 864e5));
  const dHoje = sim.dias[hojeS] || { cota_contas: 0, cota_total: 0, recebido: {}, sobra: 0, cotas: {} };
  const termo = F.termometroDia({ custoDiario: dHoje.cota_total, lucroHoje: lucroDe(vHoje), vendasHoje: vHoje.reduce((s, v) => s + v.total, 0), margem,
    temContas: E.despesas.length > 0 || dHoje.cota_total > 0 });
  termo.contas_hoje = dHoje.cota_contas;
  if (!infoHoje.aberto) termo.mensagem = `Hoje a loja não abre${infoHoje.feriado ? ` (${infoHoje.feriado})` : ""}. As contas de hoje já estão divididas entre os dias úteis do mês. 😴`;
  termo.divisao_sobra = F.dividirSobra(termo.sobra, cfg);
  termo.aberto = infoHoje.aberto; termo.peso = infoHoje.peso;
  termo.meta_lucro = dHoje.cota_total; termo.meta_venda = F.vendaNecessaria(dHoje.cota_total, margem);
  const dh = diario[hojeS] || { custo: 0, taxa: 0 };
  termo.destino = [
    ...(dh.custo > 0 ? [{ nome: "Repor as peças vendidas", tipo: "estoque", valor: Math.round(dh.custo * 100) / 100 }] : []),
    ...(dh.taxa > 0 ? [{ nome: "Maquininha", tipo: "taxa", valor: Math.round(dh.taxa * 100) / 100 }] : []),
    ...sim.caixinhas.filter((c) => c.recebeu_hoje > 0).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, valor: c.recebeu_hoje })),
    ...(dHoje.sobra > 0 ? [{ nome: "Reforço do estoque / reserva", tipo: "sobra", valor: dHoje.sobra }] : []),
  ];
  // previsão de aperto (lucro médio por dia útil das últimas 4 semanas)
  let soma28 = 0; for (let x = C.somaDias(hojeS, -28); x < hojeS; x = C.somaDias(x, 1)) soma28 += diario[x]?.lucro || 0;
  const uteis28 = cal.uteis(C.somaDias(hojeS, -28), hojeS), lucroMedioDiaUtil = uteis28 > 0 ? soma28 / uteis28 : 0;
  const cofre = estadoCofreAgora(sim, diario, tot.mensal);
  const alertas = E.vendas.length ? C.previsaoAperto(sim.caixinhas, { lucroMedioDiaUtil, margem, reserva: cofre?.reserva || 0, giro: cofre?.giro || 0, comCofre: !!cofre }) : [];

  // mês atual
  const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const vMes = vendasEntre(iniMes, new Date(hoje.getTime() + 864e5)), lucroMes = lucroDe(vMes), dia = agora.getDate();
  const contasAteHoje = Math.min(tot.mensal, calMesSafe(tot.mensal, cal, iniMesS, fimMesS, hojeS));
  const mes = { vendas: Math.round(vMes.reduce((s, v) => s + v.total, 0) * 100) / 100, lucro_bruto: Math.round(lucroMes * 100) / 100,
    contas_ate_hoje: Math.round(contasAteHoje * 100) / 100, resultado: Math.round((lucroMes - contasAteHoje) * 100) / 100,
    projecao: Math.round(((calMes.passados + infoHoje.peso > 0 ? lucroMes / (calMes.passados + infoHoje.peso) * calMes.uteis : 0) - tot.mensal) * 100) / 100 };

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

  // salário: o do mês (pode mudar mês a mês) + sugestão para este mês e o próximo
  const lucroMesHist = {}; for (const [k, v] of Object.entries(diario)) lucroMesHist[k.slice(0, 7)] = (lucroMesHist[k.slice(0, 7)] || 0) + v.lucro;
  const lucroDias = Object.fromEntries(Object.entries(diario).map(([k, v]) => [k, v.lucro]));
  const mesAtual = hojeS.slice(0, 7), proxMes = C.iso(new Date(agora.getFullYear(), agora.getMonth() + 1, 1)).slice(0, 7);
  const sugere = (m) => ({ ...C.sugerirSalario({ mes: m, lucroMes: lucroMesHist, lucroDias, cal, hoje: hojeS, contasMes: tot.mensal, sonhosMes, salarioAtual: salarioDoMes(m) }),
    definido: (cfg.salario_meses || {})[m] != null });
  const salario = { mes: mesAtual, valor: salarioDoMes(mesAtual), padrao: Number(cfg.salario_desejado) || 0, este: sugere(mesAtual), proximo: sugere(proxMes) };

  const cfo = diretorFinanceiro({ cal, diario, hojeS, calMes, tot, margem, salario, sonhosMes, cofre, mes, alertas, vMesTotal: mes.vendas });

  return {
    cfo, meta_mensal_cfg: Number(cfg.meta_mensal) || 0,
    despesas: tot.itens.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo, valor: d.valor, valores: d.valores || [], previsto: d.previsto, vencimento: d.vencimento || null })),
    contas_mes: tot.mensal, contas_dia: dHoje.cota_contas, contas_dia_util: contasPorDiaUtil, margem: Math.round(margem * 1000) / 10, margem_fonte: fonte,
    venda_minima_dia: F.vendaNecessaria(contasPorDiaUtil, margem), hoje: termo, mes, calendario: calMes,
    caixinhas: sim.caixinhas, movimentos: sim.movimentos.filter((m) => m.data >= C.somaDias(hojeS, -35)).reverse(),
    historico_contas: sim.historico.filter((h) => h.tipo === "conta" && h.venceu >= C.somaDias(hojeS, -35)).reverse(), alertas,
    lucro_medio_dia_util: Math.round(lucroMedioDiaUtil * 100) / 100, salario,
    meta: F.metaMensal({ despesasMes: tot.mensal, salario: salario.valor, sonhosMes, margem, cfg, diasUteis: calMes.uteis }),
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
  const venc = d.vencimento === "" || d.vencimento == null ? null : Math.round(Number(d.vencimento));
  if (venc != null && !(venc >= 1 && venc <= 31)) falhar("O dia do vencimento vai de 1 a 31.");
  const campos = { nome: d.nome.trim(), tipo, valor: tipo === "fixa" ? Number(d.valor) : 0, valores, vencimento: venc };
  if (id) { await banco.atualizar("despesas", id, campos); Object.assign(E.despesas.find((x) => x.id === id) || {}, campos); }
  else { const n = { id: novoId(), ordem: E.despesas.length, criado_em: new Date().toISOString(), ...campos }; await banco.inserir("despesas", [n]); E.despesas.push(n); }
  return financas();
}

async function salarioMes(d) {
  const mes = String(d.mes || ""); if (!/^\d{4}-\d{2}$/.test(mes)) falhar("Mês inválido.");
  const m = { ...(E.config.salario_meses || {}) };
  if (d.valor == null || d.valor === "") delete m[mes]; else { const v = Number(d.valor); if (!(v >= 0)) falhar("Valor inválido."); m[mes] = Math.round(v * 100) / 100; }
  E.config = { ...E.config, ...(await banco.salvarConfig({ salario_meses: m })) };
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
  const fin = financas(), h = fin.hoje, cm = fin.calendario;
  const doDia = (d) => vendasEntre(d, new Date(d.getTime() + 864e5));
  const vHoje = doDia(hoje);
  // meta de vendas de hoje: meta do mês dividida pelos dias úteis (sábado meio período vale meio dia; fechado = 0)
  const metaDia = !cm.hoje.aberto ? 0 : cfg.meta_mensal > 0 ? (cm.uteis > 0 ? cfg.meta_mensal * cm.hoje.peso / cm.uteis : 0) : (h.meta_venda || 0);
  const vendasMes = fin.mes.vendas;
  const aneis = [];
  if (h.custo_diario > 0) aneis.push({ id: "contas", nome: "Lucro do dia", valor: h.lucro_hoje, alvo: h.custo_diario, dica: "lucro de hoje × contas + salário + sonhos de hoje" });
  if (metaDia > 0) aneis.push({ id: "dia", nome: cm.hoje.peso < 1 ? "Meta de hoje (meio período)" : "Meta do dia", valor: h.vendas_hoje, alvo: Math.round(metaDia * 100) / 100, dica: "vendas de hoje" });
  const metaApp = fin.cfo.metas.metas.find((m) => m.id === "app")?.valor || 0;
  if (cfg.meta_mensal > 0) aneis.push({ id: "mes", nome: "Meta do mês", valor: vendasMes, alvo: cfg.meta_mensal, dica: "vendas do mês" });
  else if (metaApp > 0) aneis.push({ id: "mes", nome: "Meta do app (mês)", valor: vendasMes, alvo: metaApp, dica: "vendas do mês × o que o mês precisa para fechar bem" });

  // missões do dia (calculadas a partir dos dados, nada para marcar à mão)
  const ticket = fin.mes.vendas && E.vendas.length ? vendasMes / Math.max(1, E.vendas.filter((v) => new Date(v.data) >= new Date(agora.getFullYear(), agora.getMonth(), 1)).length) : 0;
  const nVendas = Math.min(8, Math.max(2, Math.ceil((metaDia || h.venda_para_cobrir || 0) / (ticket || 80)) || 2));
  const escada = R.lerEscada(cfg.escada_promocao), diasAlerta = escada.length ? escada[0][0] : 35;
  const idsHoje = new Set(vHoje.map((v) => v.id));
  const vendeuParada = E.itens_venda.some((iv) => idsHoje.has(iv.venda_id) &&
    R.diasEntre(E.lotes.find((l) => l.id === iv.lote_id)?.data_entrada || R.hojeISO()) >= diasAlerta);
  const temParada = E.lotes.some((l) => l.quantidade_atual > 0 && R.diasEntre(l.data_entrada) >= diasAlerta);
  const missoes = [];
  if (!cm.hoje.aberto) missoes.push({ id: "contas", titulo: "Dia de descanso 😴", detalhe: cm.hoje.motivo, progresso: 1, acao: null });
  else if (E.despesas.length && h.custo_diario <= 0) missoes.push({ id: "contas", titulo: "Caixinhas em dia ✅", detalhe: "contas, salário e sonhos já separados", progresso: 1, acao: null });
  else if (h.custo_diario > 0) missoes.push({ id: "contas", titulo: "Pague o dia (contas, salário, sonhos)", detalhe: h.falta > 0 ? `faltam ${R.brl(h.falta)} de lucro` : "contas pagas!",
    progresso: Math.min(1, h.lucro_hoje / h.custo_diario), acao: h.falta > 0 ? "salvar_dia" : null });
  else missoes.push({ id: "contas", titulo: "Cadastre as contas da loja", detalhe: "aluguel, luz, água…", progresso: E.despesas.length ? 1 : 0, acao: "dinheiro" });
  missoes.push({ id: "vendas", titulo: `Faça ${nVendas} vendas hoje`, detalhe: `${vHoje.length} de ${nVendas}`, progresso: Math.min(1, vHoje.length / nVendas), acao: "vender" });
  if (temParada || vendeuParada) missoes.push({ id: "parada", titulo: "Venda 1 peça parada", detalhe: `há mais de ${diasAlerta} dias na loja`, progresso: vendeuParada ? 1 : 0, acao: "promo" });
  else missoes.push({ id: "cliente", titulo: "Identifique a cliente em 1 venda", detalhe: "fideliza e libera aniversário e avisos",
    progresso: vHoje.some((v) => v.cliente_id) ? 1 : 0, acao: "vender" });

  // sequência: dias seguidos batendo o objetivo (domingo sem venda não quebra)
  // (dia que a loja não abre e não teve venda não quebra; cada dia é comparado com as contas DAQUELE dia)
  const { sim, cal } = caixinhas();
  const bateuDia = (s, vs) => { const c = sim.dias[s]?.cota_contas; return c > 0 ? lucroDe(vs) >= c - 0.01 : vs.length > 0; };
  let seq = 0;
  const hojeBateu = cm.hoje.aberto && bateuDia(R.hojeISO(), vHoje);
  for (let k = 1; k < 400; k++) {
    const d = new Date(hoje.getTime() - k * 864e5), s = C.iso(d), vs = doDia(d);
    if (cal.peso(s) === 0 && !vs.length) continue;
    if (bateuDia(s, vs)) seq++;
    else break;
  }
  if (hojeBateu) seq++;
  const objetivoSeq = E.despesas.length ? "dias seguidos pagando as contas" : "dias seguidos com venda";

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
  const cands = E.lotes.filter((l) => l.quantidade_atual > 0 && !emRelampago.has(l.id) && disponivel(l.variacao_id) > 0).map((l) => {
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
  "ultimo_mes_dividido", "taxa_debito_pct", "taxas_credito", "etiqueta_ultima", "etiqueta_definida",
  "horario", "abre_feriado", "feriados_extra", "salario_meses", "reserva_meses", "cobertura_dias"];
const verConfig = () => ({ ...Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, E.config[k]])), modo: banco.modo,
  horario_dias: C.lerHorario(E.config.horario), horario_padrao: C.HORARIO_PADRAO,
  taxas: R.taxasDaLoja(E.config), taxas_credito_texto: E.config.taxas_credito || R.TAXAS_CREDITO_PADRAO, etiquetas: infoEtiquetas(),
  logo_url: banco.urlFoto(E.config.logo) });

async function salvarConfig(d) {
  const novos = {};
  for (const k of CAMPOS_CONFIG) if (d[k] !== undefined && d[k] !== null && !(typeof d[k] === "number" && isNaN(d[k]))) novos[k] = d[k];
  if ("instagram_arroba" in novos) novos.instagram_arroba = String(novos.instagram_arroba).trim().replace(/^@/, "") || null;
  for (const k of ["whatsapp_loja", "responsavel_whatsapp", "loja_cnpj", "cep"]) if (k in novos) novos[k] = String(novos[k]).replace(/\D/g, "") || null;
  if ("nome_loja" in novos && !String(novos.nome_loja).trim()) falhar("Informe o nome da loja.");
  if (novos.horario != null && !Object.keys(C.lerHorario(novos.horario)).length && novos.horario !== "") falhar("Marque pelo menos um dia que a loja abre.");
  if (novos.horario === "") falhar("Marque pelo menos um dia que a loja abre.");
  if (novos.taxas_credito != null && !Object.keys(R.lerTaxas(novos.taxas_credito)).length) falhar("Taxas inválidas. Use o formato 1:4.99,2:6.09,3:6.89");
  if ("etiqueta_ultima" in novos) {
    novos.etiqueta_ultima = Math.max(0, Math.round(Number(novos.etiqueta_ultima) || 0));
    const maior = Math.max(0, ...E.produtos.map((p) => p.etiqueta || 0));
    novos.etiqueta_ultima = Math.max(novos.etiqueta_ultima, maior);   // nunca volta atrás de uma etiqueta já usada
  }
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
    const comId = ["produtos", "despesas", "sonhos", "vendas", "condicionais", "procuras", "variacoes"].includes(seg[0]) && seg[1];
    switch (`${m} /${seg[0]}${comId ? "/:id" : ""}${seg[2] ? "/" + seg[2] : ""}`) {
      case "GET /config": return verConfig();
      case "PUT /config": return await salvarConfig(b);
      case "POST /config": return await enviarLogo(b.get("arquivo"));
      case "GET /categorias": return R.CATEGORIAS;
      case "GET /etiquetas": return infoEtiquetas();
      case "DELETE /produtos/:id": return await apagarProduto(seg[1]);
      case "POST /variacoes/:id/tirar": return await tirarDoEstoque(seg[1], b || {});
      case "GET /produtos": {
        const busca = R.semAcento(q.get("busca") || "").toLowerCase();
        return ativos().filter((p) => R.semAcento(`${p.nome} ${p.etiqueta ?? ""}`).toLowerCase().includes(busca))
          .sort((a, b) => (b.etiqueta ?? -1) - (a.etiqueta ?? -1) || a.categoria.localeCompare(b.categoria) || a.sequencial - b.sequencial).map(produtoJson);
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
      case "GET /buscar": return buscarPecas(q.get("q"));
      case "POST /procuras": return await registrarProcura(b);
      case "GET /procuras": return radarDemanda();
      case "POST /procuras/:id/avisada": return await marcarProcura(seg[1], "avisada");
      case "POST /procuras/:id/cancelar": return await marcarProcura(seg[1], "cancelada");
      case "GET /compras": return compraInteligente(q.get("orcamento"));
      case "GET /produtos/:id/avisar": return quemAvisar(seg[1]);
      case "GET /entregas": return listarEntregas();
      case "PUT /vendas/:id/entrega": return await atualizarEntrega(seg[1], b);
      case "GET /condicionais": return listarCondicionais();
      case "POST /condicionais": return await criarCondicional(b);
      case "POST /condicionais/:id/fechar": return await fecharCondicional(seg[1], b);
      case "POST /condicionais/:id/cancelar": return await cancelarCondicional(seg[1]);
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
      case "POST /salario": return await salarioMes(b || {});
      case "POST /cofre/iniciar": return await iniciarCofre(b || {});
      case "POST /cofre": return await movimentarCofre(b || {});
      case "GET /calendario": {
        const cal = calendario(), m = q.get("mes") || R.hojeISO().slice(0, 7), ini = m + "-01", [a, mm] = m.split("-").map(Number), fim = C.iso(new Date(a, mm, 1));
        const dias = []; for (let x = ini; x < fim; x = C.somaDias(x, 1)) dias.push(cal.info(x));
        return { mes: m, uteis: cal.uteis(ini, fim), dias, feriados: cal.feriadosEntre(ini, fim), moveis: C.datasMoveis(a) };
      }
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
