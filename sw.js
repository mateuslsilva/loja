// Service worker: permite instalar o app e abrir com internet ruim.
// Sempre tenta buscar a versão NOVA dos arquivos primeiro (assim as atualizações chegam sozinhas);
// só usa a cópia guardada quando está sem internet. Os dados (Supabase) nunca passam por aqui.
const CACHE = "loja-web-v4";
const ARQUIVOS = ["./", "index.html", "icon.svg", "manifest.json", "versao.json", "js/app.js", "js/banco.js",
  "js/servico.js", "js/regras.js", "js/flyer.js", "js/tema.js", "js/financas.js", "js/assistente.js", "js/config.js"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).catch(() => {})); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) =>
  Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: "no-cache" }).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
