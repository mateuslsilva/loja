// Inicialização: escolhe o banco (Supabase ou demonstração), faz login e libera as telas.
import { criarBanco } from "./banco.js";
import { api, iniciarServico } from "./servico.js";
import { aplicarTema } from "./tema.js";

const $ = (id) => document.getElementById(id);
let banco;

// ---------- cores da loja já na abertura (antes de carregar os dados)
window.lojaTema = aplicarTema;
try { const m = JSON.parse(localStorage.getItem("loja_marca") || "null"); if (m?.p) aplicarTema(m.p, m.s); } catch { /* sem cache */ }

// ---------- atualização automática: quando um arquivo novo sobe no GitHub, o app se atualiza sozinho
let versaoAtual = null;
async function lerVersao() {
  try { return (await (await fetch("versao.json?t=" + Date.now(), { cache: "no-store" })).json()).versao; } catch { return null; }
}
async function conferirAtualizacao() {
  const v = await lerVersao();
  if (!v) return;
  if (versaoAtual === null) { versaoAtual = v; return; }
  if (v === versaoAtual) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
  const ocupado = window.lojaOcupado?.();
  const aviso = $("avisoVersao");
  aviso.style.display = "block";
  if (ocupado) { aviso.textContent = "Nova versão do app disponível. Toque aqui para atualizar."; aviso.onclick = () => location.reload(); }
  else { aviso.textContent = "Atualizando o app para a nova versão…"; setTimeout(() => location.reload(), 1200); }
}
conferirAtualizacao();
setInterval(conferirAtualizacao, 3 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") conferirAtualizacao(); });

async function abrir() {
  $("carregando").style.display = "flex";
  try {
    await iniciarServico(banco);
    window.lojaUsuario = await banco.usuario();
    $("telaLogin").classList.remove("on");
    window.dispatchEvent(new Event("loja-pronta"));
  } catch (e) {
    $("lgMsg").textContent = "Não consegui carregar os dados: " + e.message;
    $("telaLogin").classList.add("on");
  } finally {
    $("carregando").style.display = "none";
  }
}

window.lojaApi = api;

window.lojaEntrar = async (email, senha, nova) => {
  if (nova) {
    const logado = await banco.criarConta(email, senha);
    if (!logado) {
      $("lgMsg").textContent = "Conta criada! Abra o e-mail de confirmação que chegou para você e depois clique em Entrar.";
      return;
    }
  } else {
    await banco.entrar(email, senha);
  }
  $("lgMsg").textContent = "";
  await abrir();
};

window.lojaSair = async () => { await banco.sair(); location.reload(); };

(async () => {
  try {
    banco = await criarBanco();
  } catch (e) {
    $("carregando").textContent = "Sem internet para carregar o sistema. Tente de novo.";
    return;
  }
  if (await banco.usuario()) return abrir();
  $("carregando").style.display = "none";
  $("telaLogin").classList.add("on");
})();
