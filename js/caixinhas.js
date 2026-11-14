// Calendário da loja (dias que abre, horários, feriados) e "caixinhas": o lucro de cada dia é dividido
// entre as contas (cada uma com o seu vencimento), o salário do mês e os sonhos.
// Funções puras (sem banco e sem tela). Datas sempre como "AAAA-MM-DD" (dia local).

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dataDe = (s) => { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); };
export const somaDias = (s, n) => { const d = dataDe(s); d.setDate(d.getDate() + n); return iso(d); };
const ultimoDia = (a, m) => new Date(a, m + 1, 0).getDate();   // m: 0-11
export const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// ---------------------------------------------------------------- horário de funcionamento
// Texto guardado na config: "1=08:00-18:00;2=08:00-18:00;…;6=08:00-12:00" (0 = domingo). Dia ausente = fechado.
export const HORARIO_PADRAO = "1=08:00-18:00;2=08:00-18:00;3=08:00-18:00;4=08:00-18:00;5=08:00-18:00;6=08:00-13:00";
const minutos = (h) => { const [a, b] = String(h).split(":").map(Number); return a * 60 + (b || 0); };
export function lerHorario(txt) {
  const dias = {};
  for (const p of String(txt || HORARIO_PADRAO).split(";")) {
    const m = p.trim().match(/^([0-6])\s*=\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (m && minutos(m[3]) > minutos(m[2])) dias[+m[1]] = { abre: m[2], fecha: m[3], horas: (minutos(m[3]) - minutos(m[2])) / 60 };
  }
  return dias;
}
export const textoHorario = (dias) => Object.entries(dias).filter(([, v]) => v).map(([k, v]) => `${k}=${v.abre}-${v.fecha}`).join(";");

// ---------------------------------------------------------------- feriados
function pascoa(ano) {   // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31),
    dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(ano, mes - 1, dia));
}
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  return [
    [`${ano}-01-01`, "Confraternização Universal"], [somaDias(p, -2), "Sexta-feira Santa"], [`${ano}-04-21`, "Tiradentes"],
    [`${ano}-05-01`, "Dia do Trabalho"], [`${ano}-09-07`, "Independência"], [`${ano}-10-12`, "Nossa Senhora Aparecida"],
    [`${ano}-11-02`, "Finados"], [`${ano}-11-15`, "Proclamação da República"], [`${ano}-11-20`, "Consciência Negra"],
    [`${ano}-12-25`, "Natal"],
  ].map(([data, nome]) => ({ data, nome, tipo: "nacional" }));
}
/** Datas que mudam todo ano e muitas cidades fecham (a loja escolhe se conta). */
export function datasMoveis(ano) {
  const p = pascoa(ano);
  return { carnaval: [somaDias(p, -48), somaDias(p, -47)], corpus: [somaDias(p, 60)] };
}
/**
 * Feriados extras da loja (estaduais, da cidade, ou dias que ela não abre), um por linha:
 *   "08/04 Aniversário de Cuiabá"   → todo ano
 *   "24/12/2026 Véspera de Natal"    → só naquele ano
 *   "carnaval" / "corpus"            → datas móveis
 */
export function lerFeriadosExtras(txt, ano) {
  const out = [], mv = datasMoveis(ano);
  for (const linha of String(txt || "").split(/\n|;/)) {
    const l = linha.trim(); if (!l) continue;
    const t = l.toLowerCase();
    if (/^carnaval/.test(t)) { mv.carnaval.forEach((data) => out.push({ data, nome: "Carnaval", tipo: "loja" })); continue; }
    if (/^corpus/.test(t)) { out.push({ data: mv.corpus[0], nome: "Corpus Christi", tipo: "loja" }); continue; }
    const m = l.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*[-–:]?\s*(.*)$/);
    if (!m) continue;
    if (m[3] && +m[3] !== ano) continue;
    const d = +m[1], mes = +m[2];
    if (mes < 1 || mes > 12 || d < 1 || d > ultimoDia(ano, mes - 1)) continue;
    out.push({ data: `${ano}-${pad(mes)}-${pad(d)}`, nome: m[4].trim() || "Feriado", tipo: "loja" });
  }
  return out;
}

/** Monta o calendário a partir da config da loja. */
export function criarCalendario(cfg = {}) {
  const dias = lerHorario(cfg.horario), maxH = Math.max(0, ...Object.values(dias).map((d) => d.horas)) || 1;
  const cacheAno = new Map();
  const feriadosDoAno = (ano) => {
    if (!cacheAno.has(ano)) {
      const m = new Map();
      for (const f of [...feriadosNacionais(ano), ...lerFeriadosExtras(cfg.feriados_extra, ano)]) if (!m.has(f.data)) m.set(f.data, f);
      cacheAno.set(ano, m);
    }
    return cacheAno.get(ano);
  };
  const cal = {
    dias, abreFeriado: !!cfg.abre_feriado,
    feriado: (s) => feriadosDoAno(+s.slice(0, 4)).get(s) || null,
    /** Peso do dia: 1 = dia cheio; sábado meio período = 0,5; fechado/feriado = 0. */
    peso(s) {
      const h = dias[dataDe(s).getDay()];
      if (!h) return 0;
      if (cal.feriado(s) && !cal.abreFeriado) return 0;
      return Math.round(h.horas / maxH * 100) / 100;
    },
    info(s) {
      const f = cal.feriado(s), h = dias[dataDe(s).getDay()], p = cal.peso(s);
      const motivo = p > 0 ? null : f ? `feriado: ${f.nome}` : "a loja não abre neste dia";
      return { data: s, peso: p, aberto: p > 0, feriado: f?.nome || null, horario: h ? `${h.abre} às ${h.fecha}` : null, motivo, dia_semana: NOMES_DIA[dataDe(s).getDay()] };
    },
    /** Soma dos pesos de [de, ate) . */
    uteis(de, ate) { let t = 0; for (let s = de; s < ate; s = somaDias(s, 1)) t += cal.peso(s); return Math.round(t * 100) / 100; },
    feriadosEntre(de, ate) { const out = []; for (let s = de; s < ate; s = somaDias(s, 1)) { const f = cal.feriado(s); if (f) out.push({ ...f, fecha: !cal.abreFeriado && !!dias[dataDe(s).getDay()] }); } return out; },
  };
  return cal;
}

// ---------------------------------------------------------------- ciclos (vencimentos)
/** Data do vencimento no mês (dia 31 em mês de 30 dias vira dia 30). */
export const vencimentoNoMes = (ano, m, dia) => iso(new Date(ano, m, Math.min(dia, ultimoDia(ano, m))));
/**
 * Ciclo de uma conta que vence todo dia `dia`: do vencimento anterior (inclusive) até o próximo (exclusive).
 * O que entrar nesse período paga a conta do próximo vencimento. Sem vencimento: o mês do calendário.
 */
export function cicloDa(dia, s) {
  const d = dataDe(s), a = d.getFullYear(), m = d.getMonth();
  if (!dia) return { ini: iso(new Date(a, m, 1)), fim: iso(new Date(a, m + 1, 1)), vence: iso(new Date(a, m + 1, 0)) };
  // (o Date do JS aceita mês -1 e 12: vira dezembro do ano anterior / janeiro do próximo)
  const esteMes = vencimentoNoMes(a, m, dia);
  const ini = s >= esteMes ? esteMes : vencimentoNoMes(a, m - 1, dia);
  const dIni = dataDe(ini), fim = vencimentoNoMes(dIni.getFullYear(), dIni.getMonth() + 1, dia);
  return { ini, fim, vence: fim };
}

// ---------------------------------------------------------------- caixinhas
/**
 * obrigacoes: [{ id, nome, tipo: "conta"|"salario"|"sonhos", dia?: vencimento, valor(ini) → valor do ciclo que começa em ini }]
 * diario: { "AAAA-MM-DD": { lucro, vendas, custo, taxa } }
 * Simula dia a dia desde `inicio` até `hoje` (inclusive) e devolve as caixinhas do ciclo atual.
 *
 * Regra de cada dia (com o lucro do dia = vendas − valor pago nas peças − maquininha):
 *  1) cota do dia de cada caixinha = o que falta ÷ dias úteis que faltam até o vencimento × peso do dia
 *     (por isso, se um dia for fraco, os próximos dias recalculam sozinhos);
 *  2) paga as cotas na ordem: contas que vencem antes → salário → sonhos;
 *  3) o que passar das cotas adianta as contas (mais urgente primeiro), depois salário, depois sonhos;
 *  4) o que ainda sobrar vai para "reforço do estoque / reserva".
 *  5) no último dia útil antes de um vencimento, se faltar dinheiro na conta, puxa primeiro dos sonhos
 *     e só depois do salário (o mínimo possível). Os dias seguintes repõem os sonhos/salário.
 */
export function simularCaixinhas({ obrigacoes, diario, cal, inicio, hoje, socorro = ["sonhos", "salario"] }) {
  const ordem = { conta: 0, salario: 1, sonhos: 2 };
  const ciclo = (o, s) => (o.tipo === "conta" ? cicloDa(o.dia, s) : cicloDa(null, s));
  const estado = new Map();   // id → { ini, fim, vence, alvo, guardado, entradas: [] }
  const historico = [], movimentos = [], dias = {};
  const abrir = (o, s) => {
    const c = ciclo(o, s);
    const st = { ...c, alvo: r2(o.valor(c.ini, c.fim)), guardado: 0, recebeu_hoje: 0 };
    estado.set(o.id, st); return st;
  };
  for (let s = inicio; s <= hoje; s = somaDias(s, 1)) {
    // fecha ciclos vencidos e abre os novos
    for (const o of obrigacoes) {
      let st = estado.get(o.id);
      if (st && s >= st.fim) {
        historico.push({ id: o.id, nome: o.nome, tipo: o.tipo, venceu: st.vence, alvo: st.alvo, juntou: r2(st.guardado), faltou: r2(Math.max(0, st.alvo - st.guardado)) });
        st = null;
      }
      if (!st) abrir(o, s);
    }
    const peso = cal.peso(s), d = diario[s] || { lucro: 0, vendas: 0, custo: 0, taxa: 0 };
    const ativos = obrigacoes.map((o) => ({ o, st: estado.get(o.id) }))
      .sort((a, b) => ordem[a.o.tipo] - ordem[b.o.tipo] || a.st.fim.localeCompare(b.st.fim));
    // cota do dia (antes de receber)
    const cotas = ativos.map(({ o, st }) => {
      const falta = Math.max(0, st.alvo - st.guardado), uteis = cal.uteis(s, st.fim);
      return { o, st, cota: peso > 0 && uteis > 0 ? r2(falta * peso / uteis) : 0 };
    });
    // contas: ordem por vencimento (urgência) antes de salário e sonhos
    cotas.sort((a, b) => ordem[a.o.tipo] - ordem[b.o.tipo] || a.st.fim.localeCompare(b.st.fim));
    let resto = Math.max(0, d.lucro);
    const recebido = new Map();
    const dar = (x, v) => { if (v <= 0) return; x.st.guardado = r2(x.st.guardado + v); recebido.set(x.o.id, r2((recebido.get(x.o.id) || 0) + v)); resto = r2(resto - v); };
    for (const x of cotas) dar(x, Math.min(resto, x.cota));
    for (const x of cotas) dar(x, Math.min(resto, Math.max(0, x.st.alvo - x.st.guardado)));
    const sobra = r2(resto);
    // socorro: último dia útil antes do vencimento e a conta não fechou
    if (s < hoje) {
      for (const x of cotas.filter((c) => c.o.tipo === "conta")) {
        const falta = r2(x.st.alvo - x.st.guardado);
        if (falta <= 0 || cal.uteis(somaDias(s, 1), x.st.fim) > 0) continue;
        let precisa = falta;
        for (const tipo of socorro) {
          for (const y of cotas.filter((c) => c.o.tipo === tipo)) {
            const v = r2(Math.min(precisa, y.st.guardado));
            if (v > 0) { y.st.guardado = r2(y.st.guardado - v); x.st.guardado = r2(x.st.guardado + v); precisa = r2(precisa - v);
              movimentos.push({ data: s, de: y.o.nome, de_tipo: tipo, para: x.o.nome, valor: v }); }
          }
        }
      }
    }
    dias[s] = { peso, lucro: r2(d.lucro), vendas: r2(d.vendas), custo: r2(d.custo), taxa: r2(d.taxa),
      cota_total: r2(cotas.reduce((t, c) => t + c.cota, 0)), cota_contas: r2(cotas.filter((c) => c.o.tipo === "conta").reduce((t, c) => t + c.cota, 0)),
      cotas: Object.fromEntries(cotas.map((c) => [c.o.id, c.cota])), recebido: Object.fromEntries(recebido), sobra };
  }
  // situação atual
  const amanha = somaDias(hoje, 1);
  const caixinhas = obrigacoes.map((o) => {
    const st = estado.get(o.id), falta = r2(Math.max(0, st.alvo - st.guardado));
    const uteisRestam = cal.uteis(amanha, st.fim);           // a partir de amanhã
    const uteisComHoje = cal.uteis(hoje, st.fim);
    return { id: o.id, nome: o.nome, tipo: o.tipo, dia: o.dia || null, ini: st.ini, vence: st.vence, alvo: st.alvo,
      guardado: r2(st.guardado), falta, pct: st.alvo > 0 ? Math.min(100, Math.round(st.guardado / st.alvo * 100)) : 100,
      dias_ate: Math.round((dataDe(st.vence) - dataDe(hoje)) / 864e5), uteis_restam: uteisRestam, uteis_com_hoje: uteisComHoje,
      por_dia: uteisRestam > 0 ? r2(falta / uteisRestam) : falta, recebeu_hoje: dias[hoje]?.recebido[o.id] || 0, cota_hoje: dias[hoje]?.cotas[o.id] || 0 };
  }).sort((a, b) => ({ conta: 0, salario: 1, sonhos: 2 })[a.tipo] - ({ conta: 0, salario: 1, sonhos: 2 })[b.tipo] || a.vence.localeCompare(b.vence));
  return { caixinhas, historico, movimentos, dias };
}

/**
 * Previsão de aperto: com o lucro médio por dia útil, cada conta fecha até o vencimento?
 * Se não, sugere de onde tirar (sonhos primeiro, salário por último) e quanto vender a mais por dia.
 */
export function previsaoAperto(caixinhas, { lucroMedioDiaUtil, margem, reserva = 0, giro = 0, comCofre = false }) {
  const alertas = [];
  const contas = caixinhas.filter((c) => c.tipo === "conta" && c.falta > 0).sort((a, b) => a.vence.localeCompare(b.vence));
  let livre = 0;   // lucro previsto que ainda não está comprometido com contas que vencem antes
  let usadoAntes = 0;
  const sonhos = caixinhas.filter((c) => c.tipo === "sonhos").reduce((t, c) => t + c.guardado, 0);
  const salario = caixinhas.filter((c) => c.tipo === "salario").reduce((t, c) => t + c.guardado, 0);
  let tiraSonhos = 0, tiraSalario = 0, tiraReserva = 0, tiraGiro = 0;
  for (const c of contas) {
    const previsto = r2(lucroMedioDiaUtil * c.uteis_com_hoje);
    livre = previsto - usadoAntes;
    const faltaPrev = r2(c.falta - Math.max(0, livre));
    usadoAntes += Math.min(c.falta, Math.max(0, livre));
    if (faltaPrev <= 0 || c.dias_ate > 15) continue;
    // ordem: sonhos → reserva de emergência → dinheiro de compras → salário (o mínimo)
    const s1 = r2(Math.min(faltaPrev, sonhos - tiraSonhos)); tiraSonhos += s1;
    const s3 = comCofre ? r2(Math.min(faltaPrev - s1, Math.max(0, reserva - tiraReserva))) : 0; tiraReserva += s3;
    const s4 = comCofre ? r2(Math.min(faltaPrev - s1 - s3, Math.max(0, giro - tiraGiro))) : 0; tiraGiro += s4;
    const s2 = r2(Math.min(faltaPrev - s1 - s3 - s4, salario - tiraSalario)); tiraSalario += s2;
    const descoberto = r2(faltaPrev - s1 - s2 - s3 - s4);
    alertas.push({ conta: c.nome, vence: c.vence, dias_ate: c.dias_ate, falta: c.falta, falta_prevista: faltaPrev,
      tirar_sonhos: s1, tirar_reserva: s3, tirar_giro: s4, tirar_salario: s2, descoberto,
      vender_a_mais_dia: c.uteis_com_hoje > 0 ? r2(faltaPrev / c.uteis_com_hoje / Math.max(0.05, margem)) : null,
      nivel: descoberto > 0 ? "perigo" : "atencao" });
  }
  return alertas;
}

// ---------------------------------------------------------------- salário sugerido do mês
// Sazonalidade típica do varejo de moda feminina no Brasil (usada enquanto a loja não tem histórico próprio).
export const SAZONAL_MODA = { 1: 0.85, 2: 0.82, 3: 0.95, 4: 0.95, 5: 1.15, 6: 1.05, 7: 0.92, 8: 0.95, 9: 0.95, 10: 1.0, 11: 1.12, 12: 1.45 };
const NOME_MES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const chaveMes = (a, m) => `${a}-${pad(m)}`;            // m: 1-12
const mesAntes = (a, m, k) => { const t = a * 12 + (m - 1) - k; return [Math.floor(t / 12), (t % 12) + 1]; };

/**
 * lucroMes: { "AAAA-MM": lucro bruto }  ·  lucroDias: { "AAAA-MM-DD": lucro } (para o ritmo das últimas semanas)
 * Devolve a projeção do lucro do mês e o salário sugerido (com folga de segurança).
 */
export function sugerirSalario({ mes, lucroMes, lucroDias, cal, hoje, contasMes, sonhosMes = 0, salarioAtual = 0 }) {
  const [a, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`, fim = iso(new Date(a, m, 1)), uteisMes = cal.uteis(ini, fim);
  const motivos = [];
  const mesAtual = hoje.slice(0, 7);
  // só meses já fechados entram nas comparações (o mês corrente ainda está pela metade)
  lucroMes = Object.fromEntries(Object.entries(lucroMes).filter(([k]) => k < mesAtual));
  // 1) ritmo das últimas 8 semanas (por dia útil)
  const de8 = somaDias(hoje, -56);
  let soma8 = 0; for (let s = de8; s < hoje; s = somaDias(s, 1)) soma8 += lucroDias[s] || 0;
  const uteis8 = cal.uteis(de8, hoje);
  const temRitmo = soma8 > 0 && uteis8 >= 6;
  const porDiaUtil = temRitmo ? soma8 / uteis8 : 0;
  // 2) sazonalidade: quanto este mês costuma vender comparado aos 3 meses antes dele
  const fatorPadrao = SAZONAL_MODA[m] / ([1, 2, 3].map((k) => SAZONAL_MODA[mesAntes(a, m, k)[1]]).reduce((t, v) => t + v, 0) / 3);
  const fatoresLoja = [];
  for (let y = a - 1; y >= a - 3; y--) {
    const alvo = lucroMes[chaveMes(y, m)], antes = [1, 2, 3].map((k) => lucroMes[chaveMes(...mesAntes(y, m, k))]).filter((v) => v > 0);
    if (alvo > 0 && antes.length >= 2) fatoresLoja.push({ ano: y, fator: alvo / (antes.reduce((t, v) => t + v, 0) / antes.length), valor: alvo });
  }
  const fatorLoja = fatoresLoja.length ? fatoresLoja.reduce((t, f) => t + f.fator, 0) / fatoresLoja.length : null;
  const peso = fatoresLoja.length >= 2 ? 0.8 : fatoresLoja.length === 1 ? 0.6 : 0;
  const fator = fatorLoja != null ? fatorLoja * peso + fatorPadrao * (1 - peso) : fatorPadrao;
  // a sazonalidade só vale para meses futuros; no mês corrente o ritmo já carrega isso
  const aplicaFator = mes > mesAtual;
  // 3) projeção
  let projecao, base;
  if (mes === mesAtual) {
    // mês corrente: o que já entrou + o ritmo nos dias úteis que faltam
    let feito = 0; for (let s = ini; s < hoje; s = somaDias(s, 1)) feito += lucroDias[s] || 0;
    const restam = cal.uteis(hoje, fim);
    base = feito + porDiaUtil * restam; projecao = base;
    motivos.push(`Até ontem entraram ${brl0(feito)} de lucro${temRitmo ? ` e, no ritmo de ${brl0(porDiaUtil)} por dia útil, os ${fmt(restam)} dias úteis que faltam devem trazer ${brl0(porDiaUtil * restam)}` : ""}.`);
  } else if (temRitmo) {
    base = porDiaUtil * uteisMes;
    projecao = base * (aplicaFator ? fator : 1);
    motivos.push(`Ritmo das últimas 8 semanas: ${brl0(porDiaUtil)} de lucro por dia útil × ${fmt(uteisMes)} dias úteis em ${NOME_MES[m]}.`);
  } else {
    const ultimos = [1, 2, 3].map((k) => lucroMes[chaveMes(...mesAntes(a, m, k))]).filter((v) => v > 0);
    base = ultimos.length ? ultimos.reduce((t, v) => t + v, 0) / ultimos.length : 0;
    projecao = base * (aplicaFator ? fator : 1);
    if (base) motivos.push(`Média dos meses anteriores: ${brl0(base)} de lucro.`);
  }
  // compara com o mesmo mês do ano passado (corrigido pelo crescimento da loja)
  const anoPassado = lucroMes[chaveMes(a - 1, m)];
  if (anoPassado > 0 && mes !== mesAtual) {
    const r3 = [1, 2, 3].map((k) => [lucroMes[chaveMes(...mesAntes(a, m, k))], lucroMes[chaveMes(...mesAntes(a - 1, m, k))]]).filter(([x, y]) => x > 0 && y > 0);
    const cresc = r3.length ? r3.reduce((t, [x]) => t + x, 0) / r3.reduce((t, [, y]) => t + y, 0) : 1;
    const pelaHistoria = anoPassado * cresc;
    motivos.push(`Em ${NOME_MES[m]}/${a - 1} o lucro foi ${brl0(anoPassado)}${r3.length ? ` e a loja está ${cresc >= 1 ? "vendendo " + Math.round((cresc - 1) * 100) + "% a mais" : "vendendo " + Math.round((1 - cresc) * 100) + "% a menos"} que no ano passado` : ""}.`);
    projecao = projecao > 0 ? (projecao + pelaHistoria) / 2 : pelaHistoria;
  }
  if (aplicaFator && Math.abs(fator - 1) >= 0.05) {
    const pct = Math.round((fator - 1) * 100);
    motivos.push(`${NOME_MES[m][0].toUpperCase() + NOME_MES[m].slice(1)} costuma vender ${pct > 0 ? pct + "% mais" : -pct + "% menos"} que os 3 meses anteriores ${fatoresLoja.length ? "(pelo histórico da sua loja" + (peso < 1 ? " e do varejo de moda)" : ")") : "(padrão do varejo de moda; com 1 ano de uso o app passa a usar o histórico da sua loja)"}.`);
  }
  projecao = r2(Math.max(0, projecao));
  // 4) salário: projeção com folga de 15% − contas − 10% para reforçar estoque/reserva
  // no mês corrente a folga só vale para a parte que ainda não entrou
  const aindaVem = mes === mesAtual ? porDiaUtil * cal.uteis(hoje, fim) : projecao;
  const seguro = projecao - aindaVem * 0.15;
  const sugerido = Math.max(0, Math.floor((seguro - contasMes - projecao * 0.1) / 50) * 50);
  const maximo = Math.max(0, Math.floor((projecao - contasMes) / 50) * 50);
  const sobraSonhos = r2(Math.max(0, projecao - contasMes - sugerido - projecao * 0.1));
  return { mes, nome_mes: NOME_MES[m], uteis: uteisMes, projecao_lucro: projecao, contas: r2(contasMes), sugerido, maximo,
    sobra_sonhos: sobraSonhos, cobre_sonhos: sobraSonhos >= sonhosMes, atual: salarioAtual, fator: Math.round(fator * 100) / 100,
    poucos_dados: !temRitmo && !base && !anoPassado, motivos };
}
const brl0 = (v) => "R$ " + Math.round(v).toLocaleString("pt-BR");
const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString("pt-BR");
