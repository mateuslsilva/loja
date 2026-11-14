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

## Como atualizar o app (o celular se atualiza sozinho)

1. No GitHub, abra o repositório → **Add file → Upload files**.
2. Arraste os arquivos novos que eu te mandar (eles **substituem** os antigos) → **Commit changes**.
3. Em 1–2 minutos o GitHub publica. Quem estiver com o app aberto vê a faixa
   **"Atualizando o app para a nova versão…"** e ele recarrega sozinho. Se a pessoa estiver no
   meio de uma venda ou de um cadastro, aparece **"Toque aqui para atualizar"** (para não perder nada).

Quem controla isso é o arquivo `versao.json`: toda atualização vem com um número novo nele.

> Esta versão (9) trouxe `supabase/banco.sql` novo (horário da loja, feriados, vencimento das contas e salário por mês). **Rode o banco.sql de novo.**
> A versão 7 trouxe `supabase/banco.sql` novo (parcelas/acréscimo, etiquetas numeradas e apagar produto). **Rode o banco.sql de novo.**
> Quando a atualização trouxer o arquivo `supabase/banco.sql` novo, rode ele de novo no
> SQL Editor do Supabase (pode rodar quantas vezes quiser: só adiciona o que falta, não apaga dados).

> ⚠️ Depois que você colocar os dados do Supabase no `js/config.js`, **não envie o config.js
> de novo** nas próximas atualizações (senão ele volta para o modo demonstração).

## O que o app faz
- **Cadastro da loja no 1º acesso** (como o Phibo): responsável (nome, WhatsApp, e-mail), loja
  (nome, segmento, onde vende, CNPJ conferido, endereço com CEP automático), logo e metas.
- **Logo e cores**: o app lê as cores da logo e se pinta sozinho (telas e flyers).
  Dá para trocar a cor principal tocando nas cores encontradas.
- **Painel completo**: faturamento, lucro, vendas, ticket médio, peças (com comparação com o
  período anterior), meta do mês, vendas por dia, mais vendidos, formas de pagamento, resultado
  por mês, tamanhos vendidos × estoque, estoque e dinheiro parado, peças paradas,
  aniversariantes do mês e limite do MEI.
- Cadastro em grade (cor × tamanho) com **código automático** (`VES-0001-PRE-M`) e código de barras.
- Estoque **por lote**: reposição começa a contar os dias do zero; a venda baixa o lote mais antigo.
- **Robô de promoção** (roda toda vez que o app abre): 35 dias → 10%, 50 → 20%, 65 → 30%,
  preço terminado em ,90, nunca abaixo de custo + margem mínima (descontando a maquininha).
- **Flyer** de promoção ou novidade com a foto da peça (feed e story), gerado no próprio celular.
- **Compartilhar**: abre Instagram, TikTok ou WhatsApp já com o flyer; a legenda vai copiada.
- Vendas (Pix, dinheiro, débito, crédito, fiado), caixa do dia, painel com dinheiro parado e
  **limite do MEI**.

- **Aba Dinheiro**:
  - **Contas da loja**: aluguel/internet com valor fixo; energia/água com as 3 últimas contas
    (o app faz a média, prevê a próxima e mostra se está subindo).
  - **Termômetro do dia**: "a loja amanheceu devendo R$ X" (contas ÷ 30), quanto já cobriu e quanto
    falta vender, com a margem real das vendas.
  - **⚡ Salvar meu dia**: escolhe 3 peças de preço parecido e solta uma promoção relâmpago por vez
    (20%, 30%, 50%), trocando a cada 2/3/4 horas se não vender; sempre com lucro mínimo.
    Gera o flyer "RELÂMPAGO – só até as 15h".
  - **Quanto preciso vender**: para pagar as contas, tirar o salário e guardar para os sonhos.
  - **Meu dinheiro**: como usar o capital de giro (roupas, reserva, caixa) e como dividir a sobra
    (reinvestir, reserva, salário, sonhos).
  - **Meus sonhos**: quanto guardar por mês para chegar no prazo; no fechamento do mês o app sugere
    quanto colocar em cada sonho.

- **Pulso da loja** (topo da tela Vender): anéis que enchem conforme você vende (contas do dia,
  meta do dia, meta do mês), **sequência 🔥** de dias seguidos pagando as contas e **missões do dia**
  geradas pelos dados da loja ("Faça 4 vendas hoje", "Venda 1 peça parada"…), mais **conquistas**.
- **Venda avulsa ou para cliente**: a venda rápida não pede cliente; em "Para cliente" dá para
  escolher ou cadastrar a cliente na hora (nome + WhatsApp).
- **Gráficos**: rosca da meta ("Já vendeu / Da meta de"), Vendas × meta por semana, linhas de
  tendência dos últimos 14 dias nos números do painel.
- **Assistente da loja** (botão "Pergunte"): responde por texto ou voz perguntas como "quanto vendi
  hoje?", "tem vestido preto M?", "quanto falta pra meta?", "o que está parado?", "melhores clientes",
  "quanto falta pra moto?". Roda dentro do app, sem custo. Entende perguntas sobre a loja; assuntos
  fora da loja ele não responde.

- **Vender sem leitor**: o botão **+ Produtos** abre a lista do estoque com busca (nome, cor,
  tamanho); ao digitar no campo de código, aparecem sugestões.
- **Condicional**: a cliente leva as peças para provar; elas ficam reservadas no nome dela (não
  aparecem como disponíveis). Na volta, marque o que ela ficou: só isso vira venda. O app gera a
  mensagem de saída e o lembrete para o WhatsApp e avisa os atrasados.
- **Venda na loja ou online**: na online são obrigatórios nome, celular e endereço de quem recebe
  (CEP preenche a rua sozinho). O código de rastreio pode ir na hora ou depois, em **Entregas**;
  o app gera a mensagem para o WhatsApp com o rastreio.
- **Painel "De onde vêm as vendas"**: loja × online, mapa do Brasil por estado, cidades que mais
  compram e vendas para fora do Brasil.
- **Etiquetas para impressora térmica**: 40×25, 50×30, 60×40 mm, rolo de 3 colunas (33×22) ou A4.
  Código de barras EAN-13 com margens de leitura (testado lendo a imagem na resolução de 203 dpi
  das térmicas). Na impressão: tamanho do papel igual ao da etiqueta, margens "nenhuma", escala 100%.

- **Ciclo da demanda** (o diferencial):
  - **Procuraram e não tinha** (tela Vender, ou na busca de peças quando não acha): anota em 10 segundos
    o que a cliente pediu (tipo, tamanho, cor) e, se ela quiser, o contato.
  - **Radar de vendas perdidas** (tela Estoque): o que mais pedem e você não tem, e quanto deixou de vender.
  - **Compra inteligente** (tela Estoque): diga quanto vai gastar no fornecedor e o app monta a lista
    (tipo, tamanho, cor e quantidade) pelo que vende, pelo que pediram e pelo lucro de cada peça.
    Mostra também o que **não comprar** (parado) e o que vale testar (pediram, mas você não trabalha).
  - **Quem avisar**: ao cadastrar ou repor uma peça, o app mostra quem pediu aquela peça e as
    clientes que vestem o tamanho e compram esse tipo de roupa, com a mensagem pronta no WhatsApp.
  - No assistente: "o que comprar?" e "o que procuraram?".

- **Cartão parcelado**: no Crédito escolha 1x a 12x (opcional, padrão 1x). O app usa a taxa daquela
  parcela, mostra quanto você recebe e, se marcar **Repassar a taxa para a cliente**, calcula o acréscimo
  sozinho. Também tem o campo **Acréscimo** ao lado do Desconto. As taxas da sua maquininha ficam em
  **Clientes/Mais → Maquininha de cartão** (débito e crédito de 1x a 12x). ⚠️ As que vêm no app são
  exemplos: troque pelas da sua maquininha.
- **Apagar do estoque**: no produto, 🗑️ ao lado de cada cor/tamanho tira peças (cadastro a mais, perda,
  defeito) e **Apagar este produto** tira tudo. Se a peça já foi vendida, ela some do estoque mas as
  vendas continuam no histórico e no painel.
- **Etiquetas numeradas em sequência** (1, 2, 3…): no 1º cadastro o app pergunta se a loja já tinha
  etiquetas. Ex.: última = 5968 → a próxima peça nova é 5969. No cadastro escolha **Peça nova** (pega o
  próximo número) ou **Já tinha na loja** (digite o número que já está na roupa). Depois de salvar, já abre
  a impressão das etiquetas com o número em destaque. No caixa dá para digitar só o número (ex.: 4120).
  Mudar a sequência: **Configurações → Etiquetas**.
- **Código de barras com o número da etiqueta no final**: cada cor/tamanho ganha 2 dígitos na frente
  e o número da etiqueta no final. Ex.: etiqueta 5969 → `015969` (Preto M), `025969` (Preto G).
  Vale para peça nova e para peça antiga (ex.: 4120 → `014120`). Impresso em Code 128 (lê em qualquer
  leitor e na câmera). Na tela **Estoque**, o botão **📷 Ler etiqueta** abre a peça na hora.

- **Dias úteis de verdade** (não mais ÷ 30): o cadastro da loja e **Configurações → Funcionamento**
  têm os dias e horários de cada dia. Meio período vale meio dia (ex.: sábado 08:00–13:00 = 0,5).
  Domingo fechado e feriados não contam. O app já conhece os feriados nacionais (inclusive Sexta-feira
  Santa e 20/11); feriados da cidade (ex.: 08/04 Aniversário de Cuiabá), Carnaval e Corpus Christi
  você adiciona. Se a loja abrir em feriado, marque a opção.
- **Vencimento de cada conta**: o dinheiro de cada conta é separado de um vencimento até o outro
  (aluguel que vence dia 18 junta do dia 18 até o dia 17 do mês seguinte).
- **Caixinhas** (aba Dinheiro): todo lucro do dia é dividido sozinho. Primeiro as contas que vencem
  antes, depois o seu salário, depois os sonhos. O que passar disso adianta as próximas contas e, por
  fim, reforça o estoque. Se um dia for fraco, os próximos recalculam sozinhos.
  "Para onde vai o dinheiro de hoje" mostra cada real: repor as peças, maquininha, cada conta, salário, sonhos.
- **Não entrar no vermelho**: se uma conta estiver perto de vencer e o ritmo não der, o app avisa,
  tira primeiro dos sonhos e só depois do salário (o mínimo), e diz quanto vender a mais por dia.
  Os sonhos se repõem nos dias seguintes.
- **Salário do mês**: fixo no mês, mas pode mudar de um mês para o outro. No fim do mês (e antes de
  meses fortes como dezembro) o app sugere o salário do próximo mês pelo ritmo das últimas 8 semanas,
  pelo mesmo mês do ano anterior e pela época do ano (padrão do varejo de moda até ter 1 ano de histórico).

## Limites desta versão
- Os avisos de troca da promoção relâmpago aparecem com o app aberto (ou em segundo plano no
  celular, se a pessoa permitir notificações). Se o app ficar fechado, a troca acontece assim que
  alguém abrir o app.
- **Postagem 100% automática no Instagram** não existe aqui: ela precisa de um servidor ligado
  e de guardar o token da loja em segredo. O backend Python (pasta `lojamei`) já faz isso e pode
  ser ligado depois.
- Leitura de código pela câmera e Compartilhar precisam de internet para carregar na 1ª vez.

## Mexer no visual ou nas regras
- Telas: `index.html` · Regras de preço e códigos: `js/regras.js` · Flyer: `js/flyer.js`
- Depois de alterar, suba o arquivo de novo no GitHub. Em 1–2 minutos o link já atualiza.
