// Regras do negócio (mesma lógica da versão Python): códigos, promoção, piso de margem, textos.
// Funções puras: não acessam banco nem tela.

export const CATEGORIAS = {
  VES: "Vestido", BLU: "Blusa", CAL: "Calça", SAI: "Saia", SHO: "Short", MAC: "Macacão",
  CJT: "Conjunto", BOD: "Body", CRO: "Cropped", JAQ: "Jaqueta", CAM: "Camisa",
  MOD: "Moda praia", LIN: "Lingerie", ACE: "Acessório", CAD: "Calçado", OUT: "Outros",
};

export const ORDEM_TAMANHOS = ["PP", "P", "M", "G", "GG", "XG", "XGG", "U",
  "34", "36", "38", "40", "42", "44", "46", "48", "50"];

const CORES = {
  "PRETO": "PRE", "BRANCO": "BRA", "VERMELHO": "VML", "VERDE": "VRD", "AZUL": "AZU",
  "ROSA": "ROS", "PINK": "PNK", "NUDE": "NUD", "BEGE": "BEG", "CINZA": "CIN",
  "MARROM": "MAR", "AMARELO": "AMA", "LARANJA": "LAR", "LILAS": "LIL", "ROXO": "ROX",
  "VINHO": "VIN", "CARAMELO": "CRM", "OFF WHITE": "OFW", "ESTAMPADO": "EST",
  "JEANS": "JNS", "AZUL MARINHO": "AZM", "AZUL BEBE": "AZB", "VERDE MILITAR": "VDM",
  "TERRACOTA": "TER", "MOSTARDA": "MOS", "DOURADO": "DOU", "PRATA": "PRA", "CORAL": "COR",
};

export const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function siglaCategoria(categoria) {
  const cat = semAcento(categoria.trim()).toUpperCase();
  if (CATEGORIAS[cat]) return cat;
  for (const [sigla, nome] of Object.entries(CATEGORIAS)) {
    if (semAcento(nome).toUpperCase() === cat) return sigla;
  }
  return cat.slice(0, 3).padEnd(3, "X");
}

export function siglaCor(cor) {
  const chave = semAcento(cor).toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  if (CORES[chave]) return CORES[chave];
  const p = chave.split(" ").filter(Boolean);
  if (!p.length) return "XXX";
  if (p.length === 1) return p[0].slice(0, 3).padEnd(3, "X");
  return (p[0].slice(0, 2) + p[1][0]).padEnd(3, "X");
}

export const normalizaTamanho = (t) => t.trim().toUpperCase().replace("ÚNICO", "U").replace("UNICO", "U");

export const chaveTamanho = (t) => { const i = ORDEM_TAMANHOS.indexOf(t); return i < 0 ? 99 : i; };

export const titulo = (s) => s.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Código de barras EAN-13 de uso interno (prefixo 200). */
export function ean13(numero) {
  const corpo = "200" + String(numero).padStart(9, "0");
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) soma += Number(corpo[i]) * (i % 2 ? 3 : 1);
  return corpo + String((10 - (soma % 10)) % 10);
}

// ---------------------------------------------------------------- datas
export function hojeISO(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function diasEntre(dataISO, hoje = hojeISO()) {
  const [a, b] = [dataISO, hoje].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------- promoção
const arred = (v, casas = 2) => Math.round(v * 10 ** casas + Number.EPSILON * 10 ** casas) / 10 ** casas;

export function lerEscada(texto) {
  return String(texto || "").split(",").filter((p) => p.includes(":"))
    .map((p) => { const [d, x] = p.split(":"); return [parseInt(d, 10), parseFloat(x)]; })
    .filter(([d, x]) => !isNaN(d) && !isNaN(x)).sort((a, b) => a[0] - b[0]);
}

export function descontoPara(dias, escada) {
  let desc = 0;
  for (const [limite, d] of escada) if (dias >= limite) desc = d;
  return desc;
}

export function precoPiso(custo, cfg) {
  let piso = custo * (1 + cfg.margem_minima_pct / 100);
  if (cfg.considerar_taxa_cartao && cfg.taxa_cartao_pct > 0) piso = piso / (1 - cfg.taxa_cartao_pct / 100);
  return Math.ceil(arred(piso * 100, 6)) / 100;
}

/** Maior preço terminado em ,90 que não passa do valor (90,00 -> 89,90). */
export const precoPsicologico = (v) => arred(Math.floor(v - 0.9 + 1e-9) + 0.9);

export function calcularPromo(lote, cfg, hoje = hojeISO()) {
  const dias = diasEntre(lote.data_entrada, hoje);
  const desconto = descontoPara(dias, lerEscada(cfg.escada_promocao));
  const piso = precoPiso(lote.custo_unit, cfg);
  if (desconto <= 0) return { dias, desconto_pct: 0, preco: null, no_piso: false, piso };
  const alvo = precoPsicologico(lote.preco_venda * (1 - desconto / 100));
  let preco, noPiso;
  if (alvo < piso) {
    if (lote.preco_venda <= piso) return { dias, desconto_pct: 0, preco: null, no_piso: true, piso };
    preco = arred(Math.ceil(piso - 0.9 - 1e-9) + 0.9);  // menor ,90 que respeita a margem
    if (preco >= lote.preco_venda) preco = piso;
    noPiso = true;
  } else {
    preco = alvo; noPiso = false;
  }
  return { dias, desconto_pct: arred((1 - preco / lote.preco_venda) * 100, 1), preco, no_piso: noPiso, piso };
}

export const precoAtual = (l) => (l.preco_promocional ?? l.preco_venda);
export const margemPct = (preco, custo) => (preco ? arred(((preco - custo) / preco) * 100, 1) : 0);

// ---------------------------------------------------------------- textos
export function brl(v) {
  return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarZap(n) {
  const d = String(n || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return n || "";
}

export function legenda(dados) {
  const tams = dados.tamanhos.join(", "), cores = dados.cores.join(", ");
  const topo = dados.tipo === "promo"
    ? `🔥 PROMOÇÃO: ${dados.nome}\n\nDe ${brl(dados.preco_de)} por apenas ${brl(dados.preco_por)} (${dados.desconto_pct}% OFF)`
    : `✨ NOVIDADE: ${dados.nome}\n\nPor ${brl(dados.preco_por)}`;
  const zap = dados.whatsapp ? `\n📲 WhatsApp ${formatarZap(dados.whatsapp)}` : "";
  return `${topo}\n📏 Tamanhos: ${tams}\n🎨 Cores: ${cores}\n\n` +
    `Peças limitadas! Chama no direct ou passa na loja 💖${zap}\n\n` +
    "#modafeminina #lookdodia #promocao #moda #estilo #lojafeminina";
}

export function textoDivulgacao(itens, nomeLoja) {
  if (!itens.length) return { instagram: "", whatsapp: "" };
  const grupos = new Map();
  for (const i of itens) {
    if (!grupos.has(i.produto)) grupos.set(i.produto, { de: i.preco_cheio, por: i.preco_promocional, cores: new Set(), tams: new Set() });
    const g = grupos.get(i.produto);
    g.por = Math.min(g.por, i.preco_promocional); g.cores.add(i.cor); g.tams.add(i.tamanho);
  }
  const corpo = [...grupos].map(([nome, g]) =>
    `✨ ${nome} (${[...g.cores].sort().join(", ")} – tam. ${[...g.tams].sort((a, b) => chaveTamanho(a) - chaveTamanho(b)).join("/")})\n   de ${brl(g.de)} por ${brl(g.por)}`).join("\n");
  return {
    instagram: `🔥 PROMOÇÃO ${nomeLoja.toUpperCase()} 🔥\n\n${corpo}\n\nPeças com quantidade limitada! Chama no direct ou passa na loja 💖\n#modafeminina #promocao #lookdodia`,
    whatsapp: `Oi, {nome}! 💖 Separei umas peças no seu tamanho que entraram em promoção aqui na ${nomeLoja}:\n\n${corpo}\n\nQuer que eu reserve alguma pra você?`,
  };
}
