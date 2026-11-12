// Inicialização: escolhe o banco (Supabase ou demonstração), faz login e libera as telas.
import { criarBanco } from "./banco.js";
import { api, iniciarServico } from "./servico.js";

const $ = (id) => document.getElementById(id);
let banco;

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
