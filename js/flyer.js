// Gera o flyer (JPEG) no próprio aparelho, com o mesmo layout da versão Python.
//   feed  -> 1080 x 1350   |   story -> 1080 x 1920
import { brl, formatarZap } from "./regras.js";

const VINHO = "#7a2e4d", ROSA = "#f6e7ec", CREME = "#faf6f4", TEXTO = "#2a1d22", CINZA = "#7d6b72", LARANJA = "#d66e20";
const TAMANHOS = { feed: [1080, 1350], story: [1080, 1920] };
const FAMILIA = { titulo: ["Fraunces", 700], texto: ["DM Sans", 400], negrito: ["DM Sans", 700] };

let fontesProntas = null;
function carregarFontes() {
  if (fontesProntas) return fontesProntas;
  const base = new URL("../fontes/", import.meta.url);
  const lista = [["Fraunces", "fraunces-latin-700-normal.woff", 700], ["DM Sans", "dm-sans-latin-400-normal.woff", 400],
    ["DM Sans", "dm-sans-latin-700-normal.woff", 700]];
  fontesProntas = Promise.all(lista.map(async ([fam, arq, peso]) => {
    const f = new FontFace(fam, `url(${new URL(arq, base)})`, { weight: String(peso) });
    document.fonts.add(await f.load());
  })).catch(() => {});  // sem fonte, usa a do sistema
  return fontesProntas;
}

const fonte = (ctx, tipo, px) => { const [fam, peso] = FAMILIA[tipo]; ctx.font = `${peso} ${px}px "${fam}", system-ui, sans-serif`; return px; };
const larg = (ctx, t) => ctx.measureText(t).width;

function caber(ctx, txt, tipo, max, largMax, min = 20) {
  let t = max; fonte(ctx, tipo, t);
  while (t > min && larg(ctx, txt) > largMax) fonte(ctx, tipo, (t -= 2));
  return t;
}
function quebrar(ctx, txt, largMax, maxLinhas = 3) {
  const linhas = []; let atual = "";
  for (const p of txt.split(/\s+/)) {
    const teste = (atual + " " + p).trim();
    if (larg(ctx, teste) <= largMax) atual = teste; else { if (atual) linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) { linhas.length = maxLinhas; linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/[.,]$/, "") + "…"; }
  return linhas;
}
function retArred(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Escreve com o topo do texto em y (como no Pillow)
function escrever(ctx, txt, x, y, cor) { ctx.fillStyle = cor; ctx.textBaseline = "top"; ctx.fillText(txt, x, y); }

async function carregarImagem(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: "cors" }); if (!r.ok) return null;
    return await createImageBitmap(await r.blob(), { imageOrientation: "from-image" });
  } catch { return null; }
}

function desenharFoto(ctx, img, x, y, w, h, raio) {
  ctx.save(); retArred(ctx, x, y, w, h, raio); ctx.clip();
  if (img) {  // "cover" centralizado um pouco acima do meio (cabeça/busto)
    const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k;
    const sx = (img.width - sw) * 0.5, sy = (img.height - sh) * 0.4;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  } else {
    ctx.fillStyle = ROSA; ctx.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2;
    ctx.strokeStyle = VINHO; ctx.lineWidth = 8; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.arc(cx, cy - 130, 30, Math.PI, Math.PI * 2.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 100); ctx.lineTo(cx, cy - 70); ctx.lineTo(cx - 180, cy + 40);
    ctx.lineTo(cx + 180, cy + 40); ctx.lineTo(cx, cy - 70); ctx.stroke();
    fonte(ctx, "texto", 34); const t = "adicione a foto da peça";
    escrever(ctx, t, cx - larg(ctx, t) / 2, cy + 90, CINZA);
  }
  ctx.restore();
}

function selo(ctx, cx, cy, r, pct) {
  ctx.fillStyle = CREME; ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = LARANJA; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  const t = `-${Math.round(pct)}%`; caber(ctx, t, "negrito", Math.round(r * 0.8), r * 1.6);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, cx, cy - 8);
  fonte(ctx, "negrito", Math.round(r * 0.24)); ctx.textBaseline = "top"; ctx.fillText("OFF", cx, cy + r * 0.32);
  ctx.textAlign = "left";
}

function pilula(ctx, x, y, txt, tam = 28) {
  fonte(ctx, "negrito", tam); const w = larg(ctx, txt) + 40, h = Math.round(tam * 1.9);
  ctx.fillStyle = VINHO; retArred(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(txt, x + 20, y + h / 2 + 1);
  return y + h;
}

function chips(ctx, x, y, itens, largMax, alt = 62) {
  fonte(ctx, "negrito", Math.round(alt * 0.48)); let cx = x;
  for (const it of itens) {
    const w = Math.max(alt, larg(ctx, it) + 36);
    if (cx + w > x + largMax) { cx = x; y += alt + 12; }
    retArred(ctx, cx, y, w, alt, alt / 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = VINHO; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = VINHO; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it, cx + w / 2, y + alt / 2 + 1);
    ctx.textAlign = "left"; cx += w + 12;
  }
  return y + alt;
}

function textos(ctx, tx, ty, tw, d, formato) {
  const promo = d.tipo === "promo";
  if (formato === "feed") {
    ty = pilula(ctx, tx, ty, promo ? "PROMOÇÃO" : "NOVIDADE") + 26;
    fonte(ctx, "titulo", 54);
    for (const linha of quebrar(ctx, d.nome, tw)) { escrever(ctx, linha, tx, ty, TEXTO); ty += 64; }
    ty += 26;
  } else {
    caber(ctx, d.nome, "titulo", 70, tw, 44); escrever(ctx, d.nome, tx, ty, TEXTO); ty += 100;
  }
  const grande = formato === "story" ? 96 : 74;
  const preco = brl(d.preco_por);
  if (promo) {
    fonte(ctx, "texto", 34); const de = "de " + brl(d.preco_de);
    escrever(ctx, de, tx, ty, CINZA);
    const meio = ty + 34 * 0.62, x1 = tx + larg(ctx, "de ");
    ctx.strokeStyle = CINZA; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x1, meio); ctx.lineTo(tx + larg(ctx, de), meio); ctx.stroke();
    ty += 56;
    fonte(ctx, "texto", 34); const px = tx + larg(ctx, "por ");
    const t = caber(ctx, preco, "negrito", grande, tw - (px - tx)), base = ty + Math.round(t * 0.95);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = VINHO; ctx.fillText(preco, px, base);
    fonte(ctx, "texto", 34); ctx.fillText("por", tx, base);
    ty = base + 40;
  } else {
    const t = caber(ctx, preco, "negrito", grande + 6, tw), base = ty + Math.round(t * 0.95);
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = VINHO; ctx.fillText(preco, tx, base); ty = base + 40;
  }
  if (d.tamanhos?.length) {
    fonte(ctx, "negrito", 24); escrever(ctx, "TAMANHOS", tx, ty, CINZA);
    ty = chips(ctx, tx, ty + 40, d.tamanhos, tw) + 26;
  }
  if (d.cores?.length) {
    fonte(ctx, "negrito", 24); escrever(ctx, "CORES", tx, ty, CINZA);
    fonte(ctx, "texto", 32); ty += 4;
    for (const linha of quebrar(ctx, d.cores.join(", "), tw, 2)) { ty += 40; escrever(ctx, linha, tx, ty, TEXTO); }
    ty += 44;
  }
  return ty;
}

/** Retorna um Blob JPEG com o flyer. */
export async function gerarFlyer(d, formato = "feed") {
  await carregarFontes();
  const [W, H] = TAMANHOS[formato], M = 60, rodape = 110, promo = d.tipo === "promo";
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); ctx.fillStyle = CREME; ctx.fillRect(0, 0, W, H);
  const img = await carregarImagem(d.foto);

  // topo
  caber(ctx, d.loja, "titulo", 50, 620); escrever(ctx, d.loja, M, formato === "feed" ? 48 : 110, VINHO);
  if (d.arroba) {
    fonte(ctx, "texto", 30); const a = "@" + d.arroba.replace(/^@/, "");
    escrever(ctx, a, W - M - larg(ctx, a), formato === "feed" ? 62 : 124, CINZA);
  }

  if (formato === "feed") {
    const fx = M, fy = 140, fw = 580, fh = H - 140 - rodape - 40;
    desenharFoto(ctx, img, fx, fy, fw, fh, 36);
    const tx = fx + fw + 40, tw = W - tx - M;
    const minimo = fy + (promo && d.desconto_pct ? 130 : 10);
    const rasc = document.createElement("canvas").getContext("2d");   // mede a altura do bloco de texto
    rasc.canvas.width = W; rasc.canvas.height = H;
    const alturaTxt = textos(rasc, tx, 0, tw, d, formato);
    textos(ctx, tx, Math.max(minimo, fy + Math.floor((fh - alturaTxt) / 2)), tw, d, formato);
    if (promo && d.desconto_pct) selo(ctx, fx + fw - 10, fy + 20, 92, d.desconto_pct);
  } else {
    const fx = M, fy = 200, fw = W - 2 * M, fh = 980;
    desenharFoto(ctx, img, fx, fy, fw, fh, 44);
    if (promo && d.desconto_pct) selo(ctx, fx + fw - 120, fy + 120, 110, d.desconto_pct);
    pilula(ctx, fx + 30, fy + 30, promo ? "PROMOÇÃO" : "NOVIDADE", 32);
    textos(ctx, M, fy + fh + 40, W - 2 * M, d, formato);
  }

  // rodapé
  ctx.fillStyle = VINHO; ctx.fillRect(0, H - rodape, W, rodape);
  const chamada = promo ? "Peças limitadas · chama no direct!" : "Chegou! Chama no direct e garanta a sua";
  caber(ctx, chamada, "negrito", 36, W - 2 * M - (d.whatsapp ? 330 : 0));
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(chamada, M, H - rodape / 2);
  if (d.whatsapp) {
    fonte(ctx, "texto", 30); const z = "Zap " + formatarZap(d.whatsapp);
    ctx.fillStyle = ROSA; ctx.fillText(z, W - M - larg(ctx, z), H - rodape / 2);
  }
  return new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.92));
}
