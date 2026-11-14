// Contas da loja, ponto de equilíbrio, divisão do lucro, capital de giro, sonhos e "salvar meu dia".
// Funções puras (sem banco e sem tela).
import { precoPsicologico } from "./regras.js";

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
export const DIAS_MES = 30;  // conta simples: contas do mês ÷ 30

// ---------------------------------------------------------------- contas fixas
/** Valor previsto da conta: fixo, ou média das últimas contas (até 3). */
export function previsaoDespesa(d) {
  if (d.tipo === "media") {
    const vs = (d.valores || []).map(Number).filter((v) => v > 0).slice(-3);
    if (!vs.length) return { valor: 0, tendencia: null };
    const media = vs.reduce((s, v) => s + v, 0) / vs.length;
    let tendencia = null;  // subindo/descendo, comparando a última com a primeira
    if (vs.length >= 2) {
      const dif = (vs.at(-1) - vs[0]) / vs[0];
      tendencia = dif > 0.08 ? "subindo" : dif < -0.08 ? "descendo" : "estável";
    }
    return { valor: r2(media), tendencia };
  }
  return { valor: r2(Number(d.valor) || 0), tendencia: null };
}

export function totalDespesas(despesas) {
  const itens = despesas.map((d) => ({ ...d, previsto: previsaoDespesa(d) }));
  const mensal = r2(itens.reduce((s, d) => s + d.previsto.valor, 0));
  return { itens, mensal, diario: r2(mensal / DIAS_MES) };
}

// ---------------------------------------------------------------- margem e ponto de equilíbrio
/** Margem bruta real: quanto de cada R$ 1 vendido sobra depois de pagar a peça e a maquininha. */
export function margemBruta(vendas, lotes) {
  const fat = vendas.reduce((s, v) => s + v.total, 0);
  if (fat > 0 && vendas.length >= 3) {
    const lucro = vendas.reduce((s, v) => s + v.total - v.custo_total - v.taxa_pagamento, 0);
    return { margem: Math.max(0.05, lucro / fat), fonte: "vendas" };
  }
  // sem vendas suficientes: usa o estoque (preço de venda x custo)
  let venda = 0, custo = 0;
  for (const l of lotes) if (l.quantidade_atual > 0) {
    venda += l.quantidade_atual * (l.preco_promocional ?? l.preco_venda); custo += l.quantidade_atual * l.custo_unit;
  }
  if (venda > 0) return { margem: Math.max(0.05, (venda - custo) / venda), fonte: "estoque" };
  return { margem: 0.5, fonte: "padrão" };
}

/** Quanto precisa VENDER para sobrar `lucroNecessario` (com a margem informada). */
export const vendaNecessaria = (lucroNecessario, margem) => r2(Math.max(0, lucroNecessario) / margem);

// ---------------------------------------------------------------- termômetro do dia
export function termometroDia({ custoDiario, lucroHoje, vendasHoje, margem, temContas = custoDiario > 0 }) {
  // custoDiario = quanto o dia precisa de lucro (contas do dia + salário + sonhos)
  const coberto = Math.min(lucroHoje, custoDiario), falta = r2(Math.max(0, custoDiario - lucroHoje));
  const pct = custoDiario > 0 ? Math.round(lucroHoje / custoDiario * 100) : 100;
  const sobra = r2(Math.max(0, lucroHoje - custoDiario));
  let mensagem;
  if (!temContas) mensagem = "Cadastre as contas da loja para eu calcular quanto você precisa vender por dia.";
  else if (custoDiario <= 0) mensagem = "Tudo em dia! ✅ As caixinhas estão completas: hoje cada venda é lucro extra para reforçar o estoque.";
  else if (lucroHoje <= 0) mensagem = `Bom dia! Hoje a loja precisa de ${brl(custoDiario)} de lucro para as contas, o seu salário e os sonhos. Bora vender! 💪`;
  else if (pct < 50) mensagem = `Começou! Já fez ${pct}% do que o dia precisa. Continue que o dia está só começando. 🚀`;
  else if (pct < 100) mensagem = `Falta pouco! Mais ${brl(falta)} de lucro e o dia está pago. 🔥`;
  else if (pct < 200) mensagem = "Dia pago! 🎉 Contas, salário e sonhos de hoje separados. O que entrar agora adianta as próximas contas.";
  else mensagem = `Dia excelente! 🏆 Você fez ${pct}% do que o dia precisava. O excedente já está adiantando as contas.`;
  return { custo_diario: custoDiario, lucro_hoje: r2(lucroHoje), vendas_hoje: r2(vendasHoje), coberto: r2(coberto), falta,
    venda_para_cobrir: vendaNecessaria(falta, margem), pct, sobra, mensagem };
}

// ---------------------------------------------------------------- divisão do lucro
export const DIVISAO_PADRAO = { pct_reinvestir: 30, pct_reserva: 10, pct_salario: 50, pct_sonhos: 10 };

export function dividirSobra(valor, cfg) {
  const p = { ...DIVISAO_PADRAO, ...Object.fromEntries(Object.entries(cfg).filter(([k, v]) => k.startsWith("pct_") && v != null)) };
  const soma = p.pct_reinvestir + p.pct_reserva + p.pct_salario + p.pct_sonhos || 100;
  const parte = (k) => r2(Math.max(0, valor) * p[k] / soma);
  return { reinvestir: parte("pct_reinvestir"), reserva: parte("pct_reserva"), salario: parte("pct_salario"), sonhos: parte("pct_sonhos") };
}

/** Quanto precisa VENDER no mês para encher as caixinhas: contas + salário + sonhos (o que passar disso reforça o estoque). */
export function metaMensal({ despesasMes, salario, sonhosMes, margem, cfg, diasUteis = DIAS_MES }) {
  const lucroBruto = despesasMes + salario + sonhosMes;
  return { so_contas: vendaNecessaria(despesasMes, margem), com_salario: vendaNecessaria(lucroBruto, margem),
    lucro_necessario: r2(lucroBruto), por_dia: vendaNecessaria(lucroBruto / (diasUteis > 0 ? diasUteis : DIAS_MES), margem),
    sobra_necessaria: r2(salario + sonhosMes), divisao: { salario: r2(salario), sonhos: r2(sonhosMes) } };
}

// ---------------------------------------------------------------- capital de giro
export function planoCapital({ capital, despesasMes, markup }) {
  if (!(capital > 0)) return null;
  const m = markup > 1 ? markup : 2;
  // reserva: 2 meses de contas (ou 1, se o dinheiro for curto), sem passar de 40% do capital
  let reserva = Math.min(despesasMes * 2, capital * 0.4);
  if (reserva < despesasMes && capital * 0.4 >= despesasMes) reserva = despesasMes;
  const caixa = r2(Math.min(capital * 0.1, 500) + 0);           // troco / imprevistos
  const estoque = r2(Math.max(0, capital - reserva - caixa));
  const vendaTotal = r2(estoque * m), lucroBruto = r2(vendaTotal - estoque);
  return { capital: r2(capital), reserva: r2(reserva), caixa, estoque, markup: Math.round(m * 100) / 100,
    meses_reserva: despesasMes > 0 ? Math.round(reserva / despesasMes * 10) / 10 : null,
    simulacao: { venda_total: vendaTotal, lucro_bruto: lucroBruto, volta_para_estoque: estoque } };
}

// ---------------------------------------------------------------- sonhos
export function mesesEntre(hojeISO, alvoISO) {
  const [a, b] = [hojeISO, alvoISO].map((s) => +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1));
  return Math.max(1, b - a);
}

export function planoSonho(s, { hoje, sobraSonhosMes, margem, pctSonhos, totalSonhosAtivos, sobraTotalMes = 0 }) {
  const falta = r2(Math.max(0, s.valor - (s.guardado || 0)));
  const meses = s.prazo ? mesesEntre(hoje, s.prazo) : null;
  const porMes = meses ? r2(falta / meses) : null;
  // a sobra para sonhos é dividida entre os sonhos ativos
  const ritmo = totalSonhosAtivos > 0 ? r2(sobraSonhosMes / totalSonhosAtivos) : 0;
  const mesesNoRitmo = ritmo > 0 ? Math.ceil(falta / ritmo) : null;
  let vender_a_mais = 0;
  if (porMes && porMes > ritmo && pctSonhos > 0) {
    // para juntar a diferença, a sobra precisa crescer (dif * sonhos / pct) e isso vem da margem
    vender_a_mais = r2((porMes - ritmo) * totalSonhosAtivos / (pctSonhos / 100) / margem);
  }
  // alternativa mais fácil: aumentar a parte da sobra que vai para os sonhos
  let pct_sonhos_necessario = null;
  if (porMes && porMes > ritmo && sobraTotalMes > 0) {
    const p = Math.ceil(porMes * totalSonhosAtivos / sobraTotalMes * 100);
    if (p <= 60) pct_sonhos_necessario = p;
  }
  return { pct_sonhos_necessario, falta, pct: s.valor > 0 ? Math.min(100, Math.round((s.guardado || 0) / s.valor * 100)) : 0,
    meses, por_mes: porMes, por_dia: porMes ? r2(porMes / DIAS_MES) : null, ritmo_mes: ritmo,
    meses_no_ritmo: mesesNoRitmo, no_prazo: porMes == null ? null : ritmo >= porMes, vender_a_mais };
}

// ---------------------------------------------------------------- salvar meu dia (promoção relâmpago)
export const DESCONTOS_RELAMPAGO = [20, 30, 50];

function pisoRelampago(custo, cfg) {
  let piso = custo * (1 + (cfg.relampago_margem_min ?? 15) / 100);
  if (cfg.considerar_taxa_cartao && cfg.taxa_cartao_pct > 0) piso = piso / (1 - cfg.taxa_cartao_pct / 100);
  return Math.ceil(Math.round(piso * 100 * 1e6) / 1e6) / 100;
}

/**
 * Escolhe 3 peças de preço parecido (de produtos diferentes) e monta a escada de descontos.
 * A peça com MENOS margem recebe o MENOR desconto; a de MAIS margem, o maior.
 * candidatos: [{ produto_id, variacao_id, lote_id, nome, cor, tamanho, foto, preco, custo, dias, qtd }]
 */
export function sugerirRelampago(candidatos, cfg, faltaHoje = 0) {
  const descontos = String(cfg.relampago_descontos || DESCONTOS_RELAMPAGO.join(",")).split(",").map(Number).filter((n) => n > 0).slice(0, 3);
  while (descontos.length < 3) descontos.push(DESCONTOS_RELAMPAGO[descontos.length]);
  const validos = candidatos.filter((c) => c.qtd > 0 && c.preco > pisoRelampago(c.custo, cfg));
  // uma peça por produto: a mais antiga
  const porProduto = new Map();
  for (const c of validos) { const a = porProduto.get(c.produto_id); if (!a || c.dias > a.dias) porProduto.set(c.produto_id, c); }
  const lista = [...porProduto.values()];
  if (!lista.length) return [];

  // grupo de preços parecidos (±20%) com mais peças paradas; desempate: mais dias na loja
  let melhor = null;
  for (const ancora of lista) {
    const grupo = lista.filter((c) => Math.abs(c.preco - ancora.preco) <= ancora.preco * 0.2)
      .sort((a, b) => b.dias - a.dias).slice(0, 3);
    const nota = grupo.length * 1000 + grupo.reduce((s, c) => s + c.dias, 0);
    if (!melhor || nota > melhor.nota) melhor = { grupo, nota };
  }
  let grupo = melhor.grupo;
  if (grupo.length < 3) {  // completa com as mais paradas, mesmo com preço diferente
    const resto = lista.filter((c) => !grupo.includes(c)).sort((a, b) => b.dias - a.dias);
    grupo = [...grupo, ...resto].slice(0, 3);
  }
  grupo.sort((a, b) => (a.preco - a.custo) / a.preco - (b.preco - b.custo) / b.preco);  // menor margem primeiro

  let acumulado = 0;
  return grupo.map((c, i) => {
    const piso = pisoRelampago(c.custo, cfg);
    let preco = precoPsicologico(c.preco * (1 - descontos[i] / 100));
    let noPiso = false;
    if (preco < piso) { preco = r2(Math.ceil(piso - 0.9 - 1e-9) + 0.9); if (preco >= c.preco) preco = piso; noPiso = true; }
    const lucro = r2(preco - c.custo - (cfg.considerar_taxa_cartao ? preco * (cfg.taxa_cartao_pct || 0) / 100 : 0));
    acumulado = r2(acumulado + lucro);
    return { ...c, etapa: i + 1, preco_relampago: preco, desconto_pct: Math.round((1 - preco / c.preco) * 100),
      lucro, no_piso: noPiso, cobre_pct: faltaHoje > 0 ? Math.min(100, Math.round(lucro / faltaHoje * 100)) : 100,
      lucro_acumulado: acumulado };
  });
}

function brl(v) { return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
