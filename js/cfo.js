// "Diretor financeiro" da loja: cofre (reserva + giro de compras), verba de compras pelo giro do estoque,
// metas do mês, saúde da empresa e plano para quando o mês não fecha.
// Regras clássicas de gestão de varejo:
//  • reserva de emergência de 2 a 3 meses das contas fixas (a loja não pode depender da venda do mês para pagar o aluguel);
//  • o valor pago nas peças vendidas volta para comprar peças (nunca vira gasto);
//  • compra planejada pelo giro (open-to-buy): vendas previstas a preço de custo + estoque ideal − estoque que já tem;
//  • estoque parado é dinheiro parado: queimar com promoção antes de pegar dinheiro de fora;
//  • salário fixo (pró-labore), sem misturar com o dinheiro da loja;
//  • nunca pagar conta fixa com cartão rotativo, cheque especial ou empréstimo caro.
import { somaDias } from "./caixinhas.js";

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v) => "R$ " + (Math.round(v * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- cofre
/**
 * Calcula o saldo dos dois bolsos do cofre, dia a dia, a partir da data em que ele foi aberto:
 *  - reserva: recebe a sobra dos dias (depois das caixinhas) até a meta; paga as contas que não fecharam.
 *  - giro (dinheiro de compras): recebe o valor pago nas peças vendidas; paga as compras de estoque.
 * movs: lançamentos manuais [{data, bolso, valor(+/-), tipo, descricao}]
 * diario: {dia: {custo}} · dias: simulação das caixinhas {dia: {sobra}} · historico: ciclos fechados [{venceu, nome, faltou}]
 * compras: [{data, valor, descricao}]
 */
export function estadoCofre({ inicio, hoje, movs, diario, dias, historico, compras, metaReserva }) {
  let reserva = 0, giro = 0;
  const log = [];
  const porDia = (lista, campo = "data") => { const m = {}; for (const x of lista) (m[x[campo].slice(0, 10)] ||= []).push(x); return m; };
  const mv = porDia(movs), cp = porDia(compras), hs = porDia(historico.filter((h) => h.tipo === "conta" && h.faltou > 0), "venceu");   // só conta da loja; salário e sonhos não saem da reserva
  const anota = (data, texto, valor, bolso) => log.push({ data, texto, valor: r2(valor), bolso });
  for (let s = inicio.slice(0, 10); s <= hoje; s = somaDias(s, 1)) {
    for (const m of mv[s] || []) {
      if (m.tipo === "ajuste") { if (m.bolso === "reserva") reserva = m.valor; else giro = m.valor; }
      else if (m.bolso === "reserva") reserva += m.valor; else giro += m.valor;
      anota(s, m.descricao || (m.valor >= 0 ? "Entrada" : "Retirada"), m.valor, m.bolso);
    }
    // conta que venceu sem dinheiro suficiente na caixinha: reserva cobre; se não der, o giro
    for (const h of hs[s] || []) {
      let falta = h.faltou;
      const daReserva = Math.min(falta, Math.max(0, reserva)); reserva -= daReserva; falta -= daReserva;
      const doGiro = Math.min(falta, Math.max(0, giro)); giro -= doGiro; falta -= doGiro;
      if (daReserva > 0) anota(s, `Cobriu ${h.nome} (faltou na caixinha)`, -daReserva, "reserva");
      if (doGiro > 0) anota(s, `Cobriu ${h.nome} com dinheiro de compras`, -doGiro, "giro");
      if (falta > 0.01) anota(s, `${h.nome}: faltaram ${brl(falta)} (cofre vazio)`, 0, "alerta");
    }
    if (s > hoje) break;
    const custo = diario[s]?.custo || 0, sobra = dias[s]?.sobra || 0;
    if (custo > 0) giro += custo;                                   // o que foi pago nas peças vendidas volta para compras
    if (sobra > 0) {                                                // sobra do dia: completa a reserva, o resto vai para compras
      const paraReserva = Math.min(sobra, Math.max(0, metaReserva - reserva));
      reserva += paraReserva; giro += sobra - paraReserva;
    }
    for (const c of cp[s] || []) {
      giro -= c.valor;
      anota(s, c.descricao, -c.valor, "giro");
      if (giro < 0) {                                               // comprou mais do que tinha para compras
        const v = Math.min(-giro, Math.max(0, reserva));
        if (v > 0) { reserva -= v; giro += v; anota(s, "Compra passou da verba: usou a reserva", -v, "reserva"); }
      }
    }
  }
  return { reserva: r2(reserva), giro: r2(giro), log: log.reverse().slice(0, 40) };
}

/** Divide o dinheiro que a loja tem hoje (fora as roupas) entre reserva e giro, no 1º uso do cofre. */
export function dividirInicio(dinheiro, contasMes, metaMeses = 2) {
  const meta = contasMes * metaMeses;
  // até 60% do dinheiro vai para a reserva (o resto precisa girar em compras)
  const reserva = r2(Math.min(meta, dinheiro * 0.6));
  return { reserva, giro: r2(dinheiro - reserva), meta_reserva: r2(meta) };
}

// ---------------------------------------------------------------- verba de compras (open-to-buy)
/**
 * cmvDiaUtil: custo das peças vendidas por dia útil (média recente) · uteis30: dias úteis dos próximos 30 dias
 * estoqueCusto: estoque disponível a preço de custo · paradoCusto: parte dele parada há mais de N dias
 */
export function verbaCompras({ cmvDiaUtil, uteis30, fatorSazonal = 1, estoqueCusto, paradoCusto, coberturaDias = 60, giro, temCofre, apertado = 0 }) {
  const cmv30 = r2(cmvDiaUtil * uteis30 * fatorSazonal);
  if (cmv30 <= 0) return { sem_dados: true, estoque_custo: r2(estoqueCusto), parado_custo: r2(paradoCusto) };
  const estoqueUtil = Math.max(0, estoqueCusto - paradoCusto * 0.5);      // peça parada vale meia peça
  const alvo = r2(cmv30 * coberturaDias / 30);
  const verba = r2(Math.max(0, cmv30 + alvo - estoqueUtil));
  const cobertura = Math.round(estoqueUtil / (cmv30 / 30));
  let pode = temCofre ? r2(Math.max(0, Math.min(verba, giro))) : verba;
  // mês que não fecha: compra só a reposição do que vende rápido (metade do que deve vender em 30 dias), sem novidade
  const limiteAperto = apertado > 0 ? r2(cmv30 * 0.5) : null;
  if (limiteAperto != null) pode = r2(Math.min(pode, limiteAperto));
  const novidades = apertado > 0 ? 0 : r2(Math.round(pode * 0.3 / 10) * 10);
  let situacao;
  if (apertado > 0 && verba > 0) situacao = { nivel: "atencao", texto: `Mês apertado: compre no máximo ${brl(pode)}, só repondo o que vende rápido. Novidade fica para quando o caixa voltar.` };
  else if (cobertura > coberturaDias * 1.6) situacao = { nivel: "excesso", texto: `O estoque dá para ${cobertura} dias de venda. Não compre agora: venda o que já tem (o ideal é ${coberturaDias} dias).` };
  else if (verba <= 0) situacao = { nivel: "ok", texto: `Estoque na medida (${cobertura} dias de venda). Compre só se surgir oportunidade.` };
  else if (temCofre && giro < verba) situacao = { nivel: "atencao", texto: `O estoque pede ${brl(verba)} em compras, mas o dinheiro de compras tem ${brl(Math.max(0, giro))}. Compre só ${brl(pode)} e priorize o que mais vende.` };
  else situacao = { nivel: "ok", texto: `Pode comprar até ${brl(pode)} para manter ${coberturaDias} dias de estoque.` };
  return { cmv_30: cmv30, estoque_custo: r2(estoqueCusto), parado_custo: r2(paradoCusto), estoque_util: r2(estoqueUtil),
    estoque_alvo: alvo, cobertura_dias: cobertura, cobertura_alvo: coberturaDias, verba, pode_comprar: pode,
    novidades, reposicao: r2(pode - novidades), situacao, fator: fatorSazonal };
}

// ---------------------------------------------------------------- metas do mês
/**
 * Três metas de VENDA do mês:
 *  - mínima: só paga as contas;
 *  - meta do app (fechar bem): contas + salário + sonhos + recompor a reserva (em 3 meses);
 *  - a sua meta (se tiver).
 * E a previsão de fechamento no ritmo atual.
 */
export function metasMes({ minhaMeta, contasMes, salario, sonhos, margem, faltaReserva, uteisMes, uteisRestam, vendidoMes, vendaDiaUtil }) {
  const m = Math.max(0.05, margem);
  const recompor = r2(Math.max(0, faltaReserva) / 3);
  const minima = r2(contasMes / m), boa = r2((contasMes + salario + sonhos + recompor) / m);
  const previsao = r2(vendidoMes + vendaDiaUtil * uteisRestam);
  const item = (id, nome, valor, detalhe) => ({ id, nome, valor, detalhe, falta: r2(Math.max(0, valor - vendidoMes)),
    por_dia: uteisRestam > 0 ? r2(Math.max(0, valor - vendidoMes) / uteisRestam) : 0, previsao_bate: previsao >= valor - 0.01 });
  const metas = [
    item("minima", "Mínimo para pagar as contas", minima, `contas ${brl(contasMes)}`),
    item("app", "Meta do app (fechar bem o mês)", boa, `contas + salário${sonhos > 0 ? " + sonhos" : ""}${recompor > 0 ? ` + ${brl(recompor)} para recompor a reserva` : ""}`),
  ];
  if (minhaMeta > 0) metas.push(item("minha", "A sua meta", r2(minhaMeta), ""));
  let conselho = null;
  if (minhaMeta > 0 && minhaMeta < boa * 0.95) conselho = `A sua meta (${brl(minhaMeta)}) está abaixo do que o mês precisa para fechar bem (${brl(boa)}). Se bater só a sua, o salário ou os sonhos ficam curtos.`;
  else if (minhaMeta > boa * 1.6) conselho = `A sua meta é bem ousada (${Math.round(minhaMeta / boa * 100)}% do necessário). Ótimo, mas acompanhe pela meta do app para não se frustrar.`;
  return { metas, previsao, vendido: r2(vendidoMes), uteis_restam: uteisRestam, conselho };
}

// ---------------------------------------------------------------- plano para o mês que não fecha
/**
 * buraco: quanto falta (lucro previsto do mês − contas − salário). Fontes na ordem dos bons gestores:
 * 1) sonhos do mês · 2) queima do estoque parado · 3) reserva de emergência · 4) adiar compras (giro)
 * 5) reduzir o salário (o mínimo) · 6) negociar prazo. Nunca: cartão rotativo, cheque especial, empréstimo caro.
 */
export function planoMesApertado({ buraco, sonhosMes, reserva, paradoCusto, paradoVenda, giro, verbaCompra, salario }) {
  if (!(buraco > 0)) return null;
  let resta = buraco; const passos = [];
  const passo = (titulo, valor, texto) => { const v = r2(Math.min(resta, Math.max(0, valor))); if (v <= 0) return; passos.push({ titulo, valor: v, texto }); resta = r2(resta - v); };
  passo("Pausar os sonhos este mês", sonhosMes, "O sonho não acaba: só anda mais devagar e volta no mês seguinte.");
  passo("Queimar o estoque parado", Math.min(paradoVenda * 0.3, paradoCusto * 0.6), `Promoção nas peças paradas (${brl(paradoCusto)} pagos nelas): roupa parada vira dinheiro na mão, sempre acima do custo. Use o ⚡ Salvar meu dia.`);
  passo("Usar a reserva de emergência", reserva, "É para isso que ela existe. Nos próximos meses o app repõe a reserva com a sobra.");
  passo("Adiar parte das compras", Math.max(0, Math.min(giro, giro - verbaCompra * 0.5)), "Compre só o que gira rápido até o caixa voltar; deixe novidade para o mês que vem.");
  passo("Reduzir o salário deste mês (o mínimo)", salario * 0.5, "Só depois de tudo acima. Volta ao normal no mês seguinte.");
  if (resta > 0) passos.push({ titulo: "Negociar prazo", valor: r2(resta), texto: "Peça para pagar o fornecedor ou o aluguel alguns dias depois. Evite cartão rotativo, cheque especial ou empréstimo para pagar conta fixa." });
  return { buraco: r2(buraco), passos, coberto: r2(buraco - Math.max(0, resta)) };
}

// ---------------------------------------------------------------- saúde da empresa
export function saude({ reservaMeses, metaReservaMeses, cobertura, coberturaAlvo, pctParado, margem, previsaoVsMinima, temVendas, temCofre }) {
  const ind = [];
  const add = (id, nome, valor, nota, ideal, dica) => ind.push({ id, nome, valor, nota: Math.max(0, Math.min(100, Math.round(nota))), ideal, dica });
  if (temCofre) add("reserva", "Reserva de emergência", `${reservaMeses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mês(es) de contas`, reservaMeses / metaReservaMeses * 100,
    `${metaReservaMeses} meses`, reservaMeses < 1 ? "Prioridade: a sobra dos dias vai para a reserva até ela cobrir 1 mês de contas." : null);
  if (temVendas && margem > 0) add("margem", "Margem (o que sobra de cada venda)", `${Math.round(margem * 100)}%`, margem >= 0.5 ? 100 : margem / 0.5 * 100, "50% ou mais",
    margem < 0.4 ? "Margem baixa: revise preços ou negocie com o fornecedor. Roupa feminina costuma vender com o dobro do custo." : null);
  if (cobertura != null) add("cobertura", "Estoque para quantos dias", `${cobertura} dias`, cobertura <= coberturaAlvo * 1.3 ? (cobertura >= coberturaAlvo * 0.5 ? 100 : cobertura / (coberturaAlvo * 0.5) * 100) : Math.max(0, 100 - (cobertura - coberturaAlvo * 1.3) / coberturaAlvo * 80),
    `${Math.round(coberturaAlvo * 0.5)} a ${Math.round(coberturaAlvo * 1.3)} dias`, cobertura > coberturaAlvo * 1.6 ? "Estoque demais para o que vende: segure as compras e gire o que tem." : cobertura < coberturaAlvo * 0.5 ? "Estoque curto: falta peça para vender. Use a verba de compras." : null);
  add("parado", "Estoque parado (35+ dias)", `${Math.round(pctParado)}%`, pctParado <= 20 ? 100 : Math.max(0, 100 - (pctParado - 20) * 2.5), "até 20%",
    pctParado > 30 ? "Muito dinheiro parado em roupa: rode o robô de promoção e o ⚡ Salvar meu dia." : null);
  if (temVendas && previsaoVsMinima != null) add("ritmo", "Ritmo de vendas × contas", `${Math.round(previsaoVsMinima * 100)}% do mínimo`, Math.min(100, (previsaoVsMinima - 0.6) / 0.8 * 100), "acima de 140%",
    previsaoVsMinima < 1 ? "No ritmo atual as vendas não pagam as contas do mês. Veja o plano abaixo." : null);
  const nota = ind.length ? Math.round(ind.reduce((t, i) => t + i.nota, 0) / ind.length) : null;
  const rotulo = nota == null ? "Sem dados" : nota >= 75 ? "Saudável" : nota >= 50 ? "Atenção" : "Risco";
  return { nota, rotulo, indicadores: ind };
}
