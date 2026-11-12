# Gestão da Loja – versão web (GitHub Pages + Supabase)

App de gestão da loja de roupa feminina que roda no celular (Android e iPhone) e no notebook,
sem servidor próprio. As telas ficam no **GitHub Pages** e os dados no **Supabase** (gratuito).

São 2 etapas. Depois da Etapa 1 você **já testa no celular** (modo demonstração).

---

## Etapa 1 – Colocar no ar pelo GitHub (10 min)

1. Entre no github.com e clique em **New repository**.
   - Nome: `loja` (ou outro).
   - Marque **Public** (o GitHub Pages grátis exige repositório público. Não tem problema:
     não há senha nem dado da loja nos arquivos).
   - Clique em **Create repository**.
2. Na página do repositório, clique em **uploading an existing file**.
3. Extraia o zip no computador, abra a pasta `lojaweb` e **arraste TUDO que está dentro dela**
   (`index.html`, `manifest.json`, `sw.js`, `icon.svg` e as pastas `js`, `fontes`, `supabase`).
   Depois clique em **Commit changes**.
4. Vá em **Settings → Pages**. Em "Branch", escolha **main** e a pasta **/ (root)**, depois **Save**.
5. Espere 1 ou 2 minutos. O link aparece no topo da página Pages, algo como:
   `https://SEU-USUARIO.github.io/loja/`

**Testar no celular:** abra esse link no Chrome (Android) ou no Safari (iPhone).
- Android: menu ⋮ → **Instalar app**.
- iPhone: botão Compartilhar → **Adicionar à Tela de Início**.

Nesse momento ele roda em **modo demonstração** (faixa laranja no topo): tudo funciona, mas os
dados ficam só naquele aparelho. Ótimo para testar à vontade.

---

## Etapa 2 – Ligar a nuvem (Supabase) (15 min)

1. Entre em supabase.com → **Start your project** → crie a conta (pode ser com o GitHub).
2. **New project**: nome `loja`, crie uma senha do banco (guarde-a), região **South America (São Paulo)**.
   Espere o projeto ficar pronto (~2 min).
3. Menu **SQL Editor** → **New query** → abra o arquivo `supabase/banco.sql`, copie TUDO,
   cole e clique em **Run**. Deve aparecer "Success".
4. Menu **Project Settings → API** (ou **Data API**). Copie:
   - **Project URL** (ex.: `https://abcdefgh.supabase.co`)
   - **anon public key** (um texto bem grande começando com `eyJ...`)
5. No GitHub, abra o arquivo `js/config.js` → ícone de lápis (editar) → cole os dois valores:
   ```js
   export const SUPABASE_URL = "https://abcdefgh.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   → **Commit changes**. Essa chave "anon" é pública mesmo: quem protege os dados são as regras
   do banco (cada login só enxerga a própria loja).
6. No Supabase, menu **Authentication → URL Configuration** → em **Site URL** coloque o link do
   GitHub Pages (ex.: `https://SEU-USUARIO.github.io/loja/`) → Save.
   (É para onde o e-mail de confirmação manda a pessoa.)

**Primeiro acesso:** abra o link → **Criar conta** com o e-mail e uma senha da loja → confirme
pelo e-mail que chega → **Entrar**. Use **o mesmo login** no celular da sua esposa, no seu e
no notebook: todos veem os mesmos produtos e vendas.

**Recomendado depois de criar a conta:** Supabase → **Authentication → Sign In / Providers**
→ desligue **Allow new users to sign up**. Assim ninguém de fora cria conta no seu app.

> Se o app já estava instalado em modo demonstração, feche e abra de novo (ou recarregue a página)
> para ele pegar a configuração nova. Os dados de teste do modo demonstração não vão para a nuvem.

---

## O que o app faz
- Cadastro em grade (cor × tamanho) com **código automático** (`VES-0001-PRE-M`) e código de barras.
- Estoque **por lote**: reposição começa a contar os dias do zero; a venda baixa o lote mais antigo.
- **Robô de promoção** (roda toda vez que o app abre): 35 dias → 10%, 50 → 20%, 65 → 30%,
  preço terminado em ,90, nunca abaixo de custo + margem mínima (descontando a maquininha).
- **Flyer** de promoção ou novidade com a foto da peça (feed e story), gerado no próprio celular.
- **Compartilhar**: abre Instagram, TikTok ou WhatsApp já com o flyer; a legenda vai copiada.
- Vendas (Pix, dinheiro, débito, crédito, fiado), caixa do dia, painel com dinheiro parado e
  **limite do MEI**.

## Limites desta versão
- **Postagem 100% automática no Instagram** não existe aqui: ela precisa de um servidor ligado
  e de guardar o token da loja em segredo. O backend Python (pasta `lojamei`) já faz isso e pode
  ser ligado depois.
- Leitura de código pela câmera e Compartilhar precisam de internet para carregar na 1ª vez.

## Mexer no visual ou nas regras
- Telas: `index.html` · Regras de preço e códigos: `js/regras.js` · Flyer: `js/flyer.js`
- Depois de alterar, suba o arquivo de novo no GitHub. Em 1–2 minutos o link já atualiza.
