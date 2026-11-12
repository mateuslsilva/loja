// Assistente da loja: entende perguntas rápidas em português e responde com os dados reais da loja.
// Roda dentro do app (sem custo, funciona mesmo com internet fraca). Cada resposta pode trazer botões de ação.
import { api } from "./servico.js";
import { brl, semAcento, ORDEM_TAMANHOS } from "./regras.js";

const norm = (t) => semAcento(String(t || "")).toLowerCase().replace(/[^\w\s/]/g, " ").replace(/\s+/g, " ").trim();
const tem = (q, re) => re.test(q);
const pct = (v) => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const PALAVRAS_VAZIAS = new Set(("tem tenho temos quanto quantos quantas quanta custa custam preco valor estoque de do da dos das o a os as " +
  "um uma no na nos nas em e eu ainda sobrou sobraram resta restam me qual quais ta esta estao peca pecas tamanho cor " +
  "loja minha meu vendi vendeu vendemos vende hoje ontem mes semana ano esse essa isso para pra por com que ja voce sabe " +
  "disponivel disponiveis").split(" "));

function periodo(q) {
  if (tem(q, /\bontem\b/)) return { id: "ontem", nome: "ontem" };
  if (tem(q, /\bsemana\b|7 dias/)) return { id: "7d", nome: "nos últimos 7 dias" };
  if (tem(q, /\bano\b/)) return { id: "ano", nome: "este ano" };
  if (tem(q, /\bmes\b/)) return { id: "mes", nome: "este mês" };
  return { id: "hoje", nome: "hoje" };
}


async function resumoPeriodo(p) {
  if (p.id === "ontem") {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const z = (n) => String(n).padStart(2, "0"), dia = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    const v = await api("/vendas?dia=" + dia);
    return { faturamento: v.total, lucro: v.lucro, vendas: v.quantidade_vendas, ticket: v.quantidade_vendas ? v.total / v.quantidade_vendas : 0 };
  }
  return (await api("/painel?periodo=" + p.id)).atual;
}

/** Procura produtos citados na pergunta (por nome, cor e tamanho). */
async function acharProdutos(q) {
  const produtos = await api("/produtos");
  const palavras = q.split(" ").filter((w) => w.length > 2 && !PALAVRAS_VAZIAS.has(w)).map((w) => w.replace(/s$/, ""));
  const tamanho = ORDEM_TAMANHOS.find((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(q));
  const achados = [];
  for (const p of produtos) {
    const nome = norm(p.nome + " " + p.categoria);
    const casa = palavras.filter((w) => nome.includes(w));
    if (!casa.length) continue;
    let vs = p.variacoes;
    const cores = [...new Set(vs.map((v) => v.cor))].filter((c) => q.includes(norm(c)));
    if (cores.length) vs = vs.filter((v) => cores.includes(v.cor));
    if (tamanho) vs = vs.filter((v) => v.tamanho === tamanho);
    achados.push({ p, vs, nota: casa.length, filtro: [cores.join("/"), tamanho].filter(Boolean).join(" ") });
  }
  const melhor = Math.max(0, ...achados.map((a) => a.nota));
  return achados.filter((a) => a.nota === melhor);
}

const INTENCOES = [
  { id: "oi", re: /^(oi|ola|opa|bom dia|boa tarde|boa noite|e ai)\b/, f: async () => {
    const p = await api("/pulso");
    return { texto: `${p.saudacao} Já fez ${p.missoes_feitas} de ${p.missoes.length} missões hoje. Pergunte o que quiser sobre a loja: vendas, estoque, meta, contas…`,
      acoes: [{ rotulo: "Ver missões", acao: "ir:vender" }] };
  } },
  { id: "ajuda", re: /ajuda|o que (voce )?(sabe|faz|pode)|como (te )?usar|comandos/, f: async () => ({
    texto: "Posso responder coisas como:<br>• Quanto vendi hoje? / este mês?<br>• Qual meu lucro do mês?<br>• Quanto falta para a meta?<br>• Quanto preciso vender hoje?<br>• Tem vestido preto M?<br>• Quanto custa a calça pantalona?<br>• Qual peça mais vende?<br>• O que está parado?<br>• Quem são minhas melhores clientes?<br>• Quem faz aniversário este mês?<br>• Quanto falta para o meu sonho?" }) },
  { id: "comprar", re: /o que comprar|comprar mais|lista de compra|repor|fornecedor|investir em (roupa|estoque|peca)/, f: async () => {
    const c = await api("/compras");
    if (!c.compras.length) return { texto: c.poucos_dados ? "Ainda tenho poucos dados. Registre vendas e as procuras (o que pediram e não tinha) que eu monto a lista de compras." : "Pelo que vende hoje, seu estoque está suficiente. 👌",
      acoes: [{ rotulo: "Abrir compra inteligente", acao: "ir:estoque" }] };
    return { texto: `Com ${brl(c.orcamento)}, eu compraria:<br>` + c.compras.slice(0, 6).map((x) => `• ${x.qtd}x ${x.nome_cat} ${x.tamanho}${x.cores.length ? " (" + x.cores.join("/") + ")" : ""} – ${brl(x.custo_total)}`).join("<br>") +
      `<br>Vira ≈ ${brl(x_venda(c))} em vendas.${c.evitar.length ? "<br>Não compre: " + c.evitar.map((e) => `${e.nome_cat} ${e.tamanho}`).join(", ") + " (parados)." : ""}`,
      acoes: [{ rotulo: "Ver lista completa", acao: "ir:estoque" }] };
  } },
  { id: "procuras", re: /procur|pediram|perdi|nao tinha|falt(a|ou) (no|em) estoque/, f: async () => {
    const r = await api("/procuras");
    if (!r.itens.length) return { texto: "Nenhuma procura registrada. Quando uma cliente pedir algo que você não tem, registre em Vender → \"Procuraram e não tinha\"." };
    return { texto: `Nos últimos ${r.dias} dias pediram e não tinha (${brl(r.valor_perdido)} em vendas perdidas):<br>` +
      r.itens.slice(0, 6).map((i) => `• ${i.nome_cat}${i.tamanho ? " " + i.tamanho : ""}: ${i.pedidos} pedido(s)${i.cores.length ? " – " + i.cores.join("/") : ""}`).join("<br>"),
      acoes: [{ rotulo: "Ver radar", acao: "ir:estoque" }] };
  } },
  { id: "condicional", re: /condicional|condicionais|levou para (casa|provar)/, f: async () => {
    const cs = (await api("/condicionais")).filter((c) => c.status === "aberta");
    if (!cs.length) return { texto: "Nenhum condicional aberto agora." };
    return { texto: `${cs.length} condicional(is) aberto(s):<br>` + cs.map((c) => `• ${c.cliente}: ${c.pecas} pç (${brl(c.total)}) – ${c.atrasada ? `<b>atrasado ${c.dias_atraso} dia(s)</b>` : c.vence_hoje ? "vence hoje" : "até " + c.prazo.slice(8, 10) + "/" + c.prazo.slice(5, 7)}`).join("<br>"),
      acoes: [{ rotulo: "Ver condicionais", acao: "ir:vender" }] };
  } },
  { id: "entregas", re: /entrega|rastrei|correio|envio|enviar|postar|pedido/, f: async () => {
    const es = await api("/entregas"), ag = es.filter((e) => e.status === "aguardando_envio"), env = es.filter((e) => e.status === "enviado");
    if (!es.length) return { texto: "Nenhuma venda online registrada ainda." };
    return { texto: `${ag.length} pedido(s) aguardando envio${ag.length ? ": " + ag.map((e) => `${e.nome} (${e.cidade}/${e.uf})`).join(", ") : ""}.<br>${env.length} enviado(s) a caminho.`,
      acoes: [{ rotulo: "Ver entregas", acao: "ir:vender" }] };
  } },
  { id: "mais_vendido", re: /mais vend|campea|sucesso|sai mais|vende mais|top/, f: async (q) => {
    const p = periodo(q).id === "hoje" && !/\bhoje\b/.test(q) ? { id: "mes", nome: "este mês" } : periodo(q);
    const d = await api("/painel?periodo=" + (p.id === "ontem" ? "7d" : p.id));
    if (!d.mais_vendidos.length) return { texto: `Ainda não tem vendas ${p.nome} para eu montar o ranking.` };
    return { texto: `Mais vendidos ${p.nome}:<br>` + d.mais_vendidos.map((x, i) => `${i + 1}º ${x.nome} – ${x.qtd} pç (${brl(x.faturamento)})`).join("<br>"),
      acoes: [{ rotulo: "Abrir painel", acao: "ir:painel" }] };
  } },
  { id: "estoque", re: /\btem\b|\btenho\b|estoque|quantos|quantas|sobrou|resta|disponiv/, precisaProduto: true, f: async (q) => {
    const a = await acharProdutos(q);
    if (!a.length) {
      if (/estoque/.test(q)) { const d = await api("/painel?periodo=mes");
        return { texto: `Você tem ${d.estoque.pecas} peças no estoque: ${brl(d.estoque.custo)} pagos, valendo ${brl(d.estoque.venda)} na venda. ${d.estoque.pecas_paradas} peça(s) paradas há mais de ${d.estoque.dias_alerta} dias.`,
          acoes: [{ rotulo: "Abrir estoque", acao: "ir:estoque" }] }; }
      return null;
    }
    const linhas = a.map(({ p, vs, filtro }) => {
      const comEst = vs.filter((v) => v.quantidade > 0);
      if (!comEst.length) return `❌ ${p.nome}${filtro ? " " + filtro : ""}: sem estoque.`;
      return `✅ ${p.nome}${filtro ? " " + filtro : ""}: ${comEst.reduce((s, v) => s + v.quantidade, 0)} pç<br>` +
        comEst.map((v) => `&nbsp;&nbsp;• ${v.cor} ${v.tamanho}: ${v.quantidade} pç – ${brl(v.lotes[0]?.preco_atual)}${v.lotes[0]?.preco_promocional ? " (promoção)" : ""}`).join("<br>");
    });
    return { texto: linhas.join("<br>"), acoes: [{ rotulo: "Abrir estoque", acao: "ir:estoque" }] };
  } },
  { id: "preco", re: /preco|quanto custa|quanto (ta|esta)|valor d/, precisaProduto: true, f: async (q) => {
    const a = await acharProdutos(q); if (!a.length) return null;
    return { texto: a.map(({ p }) => {
      const ls = p.variacoes.flatMap((v) => v.lotes); if (!ls.length) return `${p.nome}: sem estoque.`;
      const l = ls.reduce((x, y) => (y.preco_atual < x.preco_atual ? y : x));
      return `${p.nome}: ${l.preco_promocional ? `de ${brl(l.preco_venda)} por <b>${brl(l.preco_atual)}</b> (promoção)` : `<b>${brl(l.preco_atual)}</b>`} · lucro ${brl(l.lucro_unit)} por peça (${pct(l.margem_pct)}%)`;
    }).join("<br>") };
  } },
  { id: "meta", re: /\bmeta\b|objetivo/, f: async () => {
    const d = await api("/painel?periodo=mes");
    if (!d.meta) return { texto: "Você ainda não definiu uma meta de vendas do mês. Defina em Clientes → Configurações.", acoes: [{ rotulo: "Definir meta", acao: "ir:mais" }] };
    const m = d.meta;
    return { texto: m.falta > 0 ? `Você está com <b>${pct(m.pct)}%</b> da meta: vendeu ${brl(m.vendido)} de ${brl(m.valor)}. Faltam <b>${brl(m.falta)}</b> em ${m.dias_restantes} dia(s), ≈ ${brl(m.por_dia)} por dia. No ritmo atual o mês fecha em ${brl(m.ritmo)}.`
      : `Meta batida! 🎉 ${brl(m.vendido)} de ${brl(m.valor)} (${pct(m.pct)}%).` };
  } },
  { id: "contas", re: /preciso vender|contas|devendo|pagar|equilibrio|empatar/, f: async () => {
    const f = await api("/financas"), h = f.hoje;
    if (f.contas_dia <= 0) return { texto: "Cadastre as contas da loja (aluguel, luz, água, internet) e eu calculo quanto você precisa vender por dia.", acoes: [{ rotulo: "Cadastrar contas", acao: "ir:dinheiro" }] };
    return { texto: h.falta > 0 ? `Hoje as contas da loja custam ${brl(h.custo_diario)}. Você já lucrou ${brl(h.lucro_hoje)}. Faltam <b>${brl(h.falta)}</b> de lucro, ou seja, vender mais uns <b>${brl(h.venda_para_cobrir)}</b>.`
      : `As contas de hoje já estão pagas! 🎉 Sobraram ${brl(h.sobra)} de lucro.`,
      acoes: h.falta > 0 ? [{ rotulo: "⚡ Salvar meu dia", acao: "salvar_dia" }] : [] };
  } },
  { id: "lucro", re: /lucr|ganhei|ganho|sobrou/, f: async (q) => {
    const p = periodo(q), r = await resumoPeriodo(p);
    return { texto: `Lucro ${p.nome}: <b>${brl(r.lucro)}</b> em ${brl(r.faturamento)} de vendas${r.faturamento ? ` (margem de ${Math.round(r.lucro / r.faturamento * 100)}%)` : ""}. Esse é o lucro das peças, antes das contas fixas da loja.` };
  } },
  { id: "ticket", re: /ticket|media por (venda|cliente)|gasto medio/, f: async (q) => {
    const p = periodo(q).id === "hoje" ? { id: "mes", nome: "este mês" } : periodo(q), r = await resumoPeriodo(p);
    return { texto: `Ticket médio ${p.nome}: <b>${brl(r.ticket)}</b> por venda (${r.vendas} vendas). Dica: oferecer um acessório no caixa aumenta o ticket.` };
  } },
  { id: "parado", re: /parad|encalh|promo|liquid|nao vende|sem vender/, f: async () => {
    const d = await api("/painel?periodo=mes");
    if (!d.encalhados.length) return { texto: "Nenhuma peça parada. Estoque girando bem! 🎉" };
    return { texto: `Peças paradas há mais tempo (${brl(d.estoque.dinheiro_parado)} de dinheiro parado):<br>` +
      d.encalhados.map((x) => `• ${x.nome} ${x.cor} ${x.tamanho}: ${x.dias} dias – ${brl(x.preco)}${x.em_promocao ? " (já em promoção)" : ""}`).join("<br>"),
      acoes: [{ rotulo: "Ver promoções", acao: "ir:promo" }, { rotulo: "⚡ Salvar meu dia", acao: "salvar_dia" }] };
  } },
  { id: "aniversario", re: /aniver/, f: async () => {
    const d = await api("/painel?periodo=mes");
    if (!d.aniversariantes.length) return { texto: "Ninguém faz aniversário este mês (entre as clientes com data cadastrada)." };
    return { texto: "Aniversariantes do mês:<br>" + d.aniversariantes.map((a) => `• ${a.nome} – dia ${a.dia}${a.hoje ? " (é hoje! 🎂)" : ""}`).join("<br>"),
      acoes: [{ rotulo: "Mandar parabéns", acao: "ir:painel" }] };
  } },
  { id: "clientes_top", re: /(melhor|melhores|fiei|fiel|mais compra|compra mais|quem compra|top) ?.*client|client.*(melhor|mais|fiel)/, f: async () => {
    const r = (await api("/clientes/ranking")).slice(0, 5);
    if (!r.length) return { texto: "Ainda não tem vendas com cliente identificada. Na hora de vender, escolha \"Para cliente\" para eu montar o ranking." };
    return { texto: "Suas melhores clientes:<br>" + r.map((c, i) => `${i + 1}º ${c.nome} – ${brl(c.total)} em ${c.compras} compra(s)`).join("<br>") };
  } },
  { id: "sumidas", re: /sumid|sumiu|nao (volta|vem|compra)|faz tempo/, f: async () => {
    const r = (await api("/clientes/ranking")).filter((c) => c.dias_sem_comprar >= 45).slice(0, 5);
    if (!r.length) return { texto: "Nenhuma cliente sumida: todas compraram nos últimos 45 dias. 👏" };
    return { texto: "Clientes que não compram há mais de 45 dias (vale mandar uma novidade):<br>" + r.map((c) => `• ${c.nome} – ${c.dias_sem_comprar} dias`).join("<br>") };
  } },
  { id: "mei", re: /\bmei\b|limite|81 mil|faturamento anual/, f: async () => {
    const m = (await api("/painel?periodo=ano")).mei;
    return { texto: `Você faturou ${brl(m.faturado)} em ${m.ano} (${pct(m.uso_pct)}% do limite de ${brl(m.limite)} do MEI). Projeção do ano: ${brl(m.projecao_ano)}.${m.alerta ? " ⚠️ " + m.alerta : ""}` };
  } },
  { id: "sonho", re: /sonho|guardar|juntar|economiz|falta (pra|para) (o |a |minha |meu )?\w+|moto|carro|viagem|casa/, f: async () => {
    const f = await api("/financas"), ss = f.sonhos.filter((s) => !s.concluido);
    if (!ss.length) return { texto: "Você ainda não cadastrou um sonho. Que tal? Uma moto, pintar a casa, uma viagem…", acoes: [{ rotulo: "Criar sonho", acao: "ir:dinheiro" }] };
    return { texto: ss.map((s) => `${s.emoji || "⭐"} ${s.nome}: ${brl(s.guardado)} de ${brl(s.valor)} (${s.plano.pct}%). Faltam ${brl(s.plano.falta)}${s.plano.por_mes ? `, guarde ${brl(s.plano.por_mes)}/mês` : ""}.`).join("<br>"),
      acoes: [{ rotulo: "Ver sonhos", acao: "ir:dinheiro" }] };
  } },
  { id: "pagamento", re: /pix|cartao|credito|debito|forma de pagamento|fiado|dinheiro vivo|especie/, f: async (q) => {
    const p = periodo(q).id === "hoje" && !/\bhoje\b/.test(q) ? { id: "mes", nome: "este mês" } : periodo(q);
    const d = await api("/painel?periodo=" + (p.id === "ontem" ? "7d" : p.id)), nomes = { pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito", fiado: "Fiado" };
    const fs = Object.entries(d.formas).sort((a, b) => b[1] - a[1]);
    if (!fs.length) return { texto: `Sem vendas ${p.nome}.` };
    return { texto: `Formas de pagamento ${p.nome}:<br>` + fs.map(([k, v]) => `• ${nomes[k] || k}: ${brl(v)}`).join("<br>") };
  } },
  { id: "vendas", re: /vend|fatur|entrou|caixa|movimento|faturei/, f: async (q) => {
    const a = /vendi .{3,}/.test(q) ? await acharProdutos(q) : [];
    const p = periodo(q);
    if (a.length) {
      const d = await api("/painel?periodo=" + (p.id === "ontem" ? "7d" : p.id));
      return { texto: a.map(({ p: pr }) => { const x = d.mais_vendidos.find((m) => m.produto_id === pr.produto_id);
        return x ? `${pr.nome}: ${x.qtd} pç vendidas ${p.nome} (${brl(x.faturamento)}).` : `${pr.nome}: não aparece entre os mais vendidos ${p.nome}.`; }).join("<br>") };
    }
    const r = await resumoPeriodo(p);
    return { texto: r.vendas ? `Você vendeu <b>${brl(r.faturamento)}</b> ${p.nome}, em ${r.vendas} venda(s). Lucro de ${brl(r.lucro)}.`
      : `Nenhuma venda ${p.nome} ainda. Bora? 💪`, acoes: r.vendas ? [] : [{ rotulo: "Nova venda", acao: "ir:vender" }] };
  } },
];

/** Responde uma pergunta. Retorna { texto (html simples), acoes: [{rotulo, acao}] }. */
export async function perguntar(pergunta) {
  const q = norm(pergunta);
  if (!q) return { texto: "Pode perguntar! Ex.: quanto vendi hoje?" };
  for (const it of INTENCOES) {
    if (!it.re.test(q)) continue;
    try {
      const r = await it.f(q);
      if (r) return { acoes: [], ...r };
    } catch (e) { return { texto: "Não consegui buscar isso agora: " + e.message }; }
  }
  // última tentativa: talvez seja só o nome de um produto
  const a = await acharProdutos(q).catch(() => []);
  if (a.length) return INTENCOES.find((i) => i.id === "estoque").f("tem " + q);
  return { texto: "Ainda não sei responder isso. Tente: \"quanto vendi hoje?\", \"tem vestido M?\", \"quanto falta pra meta?\" ou toque em Ajuda.",
    acoes: [{ rotulo: "Ajuda", acao: "perguntar:o que voce sabe" }] };
}

const x_venda = (c) => c.venda_prevista;

export const SUGESTOES = ["O que comprar?", "O que procuraram?", "Quanto vendi hoje?", "Quanto falta para a meta?", "Condicionais abertos", "Entregas pendentes", "Quanto preciso vender hoje?", "Qual peça mais vende?",
  "O que está parado?", "Melhores clientes", "Lucro do mês"];
