// Tema automático: lê as cores da logo e pinta o app (e os flyers) com elas.

// ---------------------------------------------------------------- conversões
const hex2rgb = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const misturar = (hexA, hexB, t) => { const a = hex2rgb(hexA), b = hex2rgb(hexB); return rgb2hex(...a.map((v, i) => v + (b[i] - v) * t)); };
function luminancia(hex) {
  return hex2rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Escurece a cor até o texto branco ficar legível em cima dela (contraste >= 4.5). */
function legivelComBranco(hex) {
  let [h, s, l] = rgb2hsl(...hex2rgb(hex));
  while (contraste(rgb2hex(...hsl2rgb(h, s, l)), "#ffffff") < 4.5 && l > 0.05) l -= 0.02;
  return rgb2hex(...hsl2rgb(h, s, l));
}

// ---------------------------------------------------------------- leitura da logo
/** Retorna as cores principais da imagem, da mais importante para a menos. */
export async function coresDaLogo(fonteImagem) {
  const img = fonteImagem instanceof Blob ? await createImageBitmap(fonteImagem) : fonteImagem;
  const k = Math.min(1, 140 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // fundo = cor mais comum na borda (geralmente branco); é ignorado
  const borda = new Map();
  const chave = (r, g, b) => `${r >> 4},${g >> 4},${b >> 4}`;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) {
    const i = (y * w + x) * 4; if (px[i + 3] > 128) { const c = chave(px[i], px[i + 1], px[i + 2]); borda.set(c, (borda.get(c) || 0) + 1); }
  }
  const fundo = [...borda].sort((a, b) => b[1] - a[1])[0]?.[0];

  const grupos = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    const c = chave(r, g, b);
    if (c === fundo) continue;
    const [, s, l] = rgb2hsl(r, g, b);
    if (l > 0.93 && s < 0.3) continue;  // branco/quase branco
    const gr = grupos.get(c) || { n: 0, r: 0, g: 0, b: 0 };
    gr.n++; gr.r += r; gr.g += g; gr.b += b; grupos.set(c, gr);
  }
  const totalPx = [...grupos.values()].reduce((t, g) => t + g.n, 0);
  const lista = [...grupos.values()].filter((g) => g.n >= totalPx * 0.03).map((g) => {  // ignora tons de borda/sombra
    const cor = rgb2hex(g.r / g.n, g.g / g.n, g.b / g.n), [, s, l] = rgb2hsl(...hex2rgb(cor));
    return { cor, n: g.n, s, l, peso: g.n * (0.25 + s) * (l < 0.08 ? 0.6 : 1) };
  }).sort((a, b) => b.peso - a.peso);

  // junta tons muito parecidos
  const escolhidas = [];
  for (const c of lista) {
    const rgb = hex2rgb(c.cor);
    if (escolhidas.every((e) => hex2rgb(e.cor).reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0) > 55 ** 2)) escolhidas.push(c);
    if (escolhidas.length === 6) break;
  }
  // a principal: a mais forte (colorida); se a logo for preto e branco, a mais escura
  const coloridas = escolhidas.filter((c) => c.s > 0.25 && c.l > 0.12 && c.l < 0.85);
  const ordem = coloridas.length ? [...coloridas, ...escolhidas.filter((c) => !coloridas.includes(c))] : escolhidas.sort((a, b) => a.l - b.l);
  return ordem.map((c) => c.cor);
}

// ---------------------------------------------------------------- tema
export const COR_PADRAO = "#7a2e4d";

export function gerarTema(primaria = COR_PADRAO, secundaria = null) {
  const p = legivelComBranco(primaria || COR_PADRAO);
  const [h, s] = rgb2hsl(...hex2rgb(p));
  const neutroQuente = rgb2hex(...hsl2rgb(h, Math.min(s, 0.25), 0.975));
  // destaque de promoção: a 2ª cor da logo, se for bem diferente; senão laranja
  let destaque = "#c4651a";
  if (secundaria) {
    const [h2, s2] = rgb2hsl(...hex2rgb(secundaria));
    const dif = Math.min(Math.abs(h2 - h), 360 - Math.abs(h2 - h));
    if (s2 > 0.35 && dif > 40) destaque = legivelComBranco(secundaria);
  }
  return {
    "--vinho": p,
    "--vinho2": misturar(p, "#000000", 0.25),
    "--rosa": misturar(p, "#ffffff", 0.88),
    "--rosa2": misturar(p, "#ffffff", 0.72),
    "--bg": neutroQuente,
    "--linha": misturar(misturar(p, "#ffffff", 0.86), "#888888", 0.15),
    "--tx": misturar(p, "#141014", 0.82),
    "--tx2": misturar(misturar(p, "#6b6b6b", 0.7), "#ffffff", 0.05),
    "--laranja": destaque,
    "--laranja-bg": misturar(destaque, "#ffffff", 0.86),
  };
}

export function aplicarTema(primaria, secundaria) {
  const t = gerarTema(primaria, secundaria);
  for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t["--vinho"]);
  return t;
}

/** Cores para o flyer, a partir do tema. */
export function coresFlyer(primaria, secundaria) {
  const t = gerarTema(primaria, secundaria);
  return { VINHO: t["--vinho"], ROSA: t["--rosa"], CREME: t["--bg"], TEXTO: t["--tx"], CINZA: t["--tx2"], LARANJA: t["--laranja"] };
}
