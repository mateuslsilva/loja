-- =====================================================================
-- Loja MEI – estrutura do banco no Supabase
-- Como usar: Supabase → SQL Editor → New query → cole TUDO isto → Run.
-- Pode rodar de novo sem problema (não apaga dados).
--
-- Segurança: cada conta (login) só enxerga e altera os PRÓPRIOS dados
-- (Row Level Security). Isso já deixa o sistema pronto para várias lojas.
-- =====================================================================

-- ---------- configurações (uma linha por loja/conta)
create table if not exists config (
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  nome_loja text not null default 'Minha Loja',
  margem_minima_pct double precision not null default 30,
  taxa_cartao_pct double precision not null default 4,
  considerar_taxa_cartao boolean not null default true,
  escada_promocao text not null default '35:10,50:20,65:30',
  limite_mei_anual double precision not null default 81000,
  instagram_arroba text,
  whatsapp_loja text,
  atualizado_em timestamptz not null default now()
);

-- campos do cadastro da loja, logo, cores e metas (versão 2)
alter table config add column if not exists cadastro_completo boolean not null default false;
alter table config add column if not exists responsavel_nome text;
alter table config add column if not exists responsavel_whatsapp text;
alter table config add column if not exists responsavel_email text;
alter table config add column if not exists responsavel_cargo text;
alter table config add column if not exists loja_razao_social text;
alter table config add column if not exists loja_cnpj text;
alter table config add column if not exists loja_segmento text;
alter table config add column if not exists loja_canais text;
alter table config add column if not exists cep text;
alter table config add column if not exists endereco text;
alter table config add column if not exists numero text;
alter table config add column if not exists bairro text;
alter table config add column if not exists cidade text;
alter table config add column if not exists uf text;
alter table config add column if not exists logo text;
alter table config add column if not exists cor_primaria text;
alter table config add column if not exists cor_secundaria text;
alter table config add column if not exists meta_mensal double precision not null default 0;
-- dinheiro: capital, salário, divisão do lucro e promoção relâmpago (versão 3)
alter table config add column if not exists capital_inicial double precision not null default 0;
alter table config add column if not exists salario_desejado double precision not null default 0;
alter table config add column if not exists pct_reinvestir double precision not null default 30;
alter table config add column if not exists pct_reserva double precision not null default 10;
alter table config add column if not exists pct_salario double precision not null default 50;
alter table config add column if not exists pct_sonhos double precision not null default 10;
alter table config add column if not exists relampago_horas integer not null default 3;
alter table config add column if not exists relampago_margem_min double precision not null default 15;
alter table config add column if not exists relampago_descontos text not null default '20,30,50';
alter table config add column if not exists ultimo_mes_dividido text;

-- ---------- produtos (o modelo: "Vestido midi alça")
create table if not exists produtos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  categoria text not null,
  sequencial integer not null,
  nome text not null,
  foto text,                                   -- caminho no Storage (bucket fotos)
  criado_em timestamptz not null default now(),
  unique (owner_id, categoria, sequencial)
);

-- ---------- variações (cor + tamanho), cada uma com código e código de barras
create table if not exists variacoes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  produto_id uuid not null references produtos on delete cascade,
  cor text not null,
  cor_sigla text not null,
  tamanho text not null,
  numero integer not null,                     -- base do código de barras
  codigo text not null,                        -- VES-0012-PRE-M
  codigo_barras text not null,                 -- EAN-13 interno (200...)
  unique (owner_id, codigo),
  unique (owner_id, codigo_barras)
);

-- ---------- lotes (cada entrada de estoque; os dias de loja contam por lote)
create table if not exists lotes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  variacao_id uuid not null references variacoes on delete cascade,
  data_entrada date not null default current_date,
  quantidade_inicial integer not null check (quantidade_inicial >= 0),
  quantidade_atual integer not null check (quantidade_atual >= 0),
  custo_unit double precision not null check (custo_unit > 0),
  preco_venda double precision not null check (preco_venda > 0),
  preco_promocional double precision,
  desconto_pct double precision not null default 0,
  promo_no_piso boolean not null default false,
  promo_desde date
);

alter table lotes add column if not exists relampago_ate timestamptz;  -- preço relâmpago vale até

-- ---------- contas fixas da loja (aluguel, energia, água, internet…)
create table if not exists despesas (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  nome text not null,
  tipo text not null default 'fixa' check (tipo in ('fixa','media')),  -- media = média das 3 últimas contas
  valor double precision not null default 0,
  valores jsonb not null default '[]'::jsonb,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

-- ---------- sonhos e dinheiro guardado para eles
create table if not exists sonhos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  nome text not null,
  emoji text,
  valor double precision not null check (valor > 0),
  prazo date,
  guardado double precision not null default 0,
  concluido boolean not null default false,
  criado_em timestamptz not null default now()
);
create table if not exists aportes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  sonho_id uuid not null references sonhos on delete cascade,
  valor double precision not null,
  data timestamptz not null default now(),
  origem text
);

-- ---------- "salvar meu dia": promoções relâmpago em etapas
create table if not exists relampagos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  data date not null default current_date,
  horas integer not null default 3,
  itens jsonb not null,
  status text not null default 'ativo',
  criado_em timestamptz not null default now()
);

-- ---------- clientes
create table if not exists clientes (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  nome text not null,
  whatsapp text,
  aniversario date
);

-- ---------- vendas e itens
create table if not exists vendas (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  data timestamptz not null default now(),
  cliente_id uuid references clientes on delete set null,
  forma_pagamento text not null check (forma_pagamento in ('pix','dinheiro','debito','credito','fiado')),
  total double precision not null,
  custo_total double precision not null,
  taxa_pagamento double precision not null default 0
);

create table if not exists itens_venda (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  venda_id uuid not null references vendas on delete cascade,
  variacao_id uuid not null references variacoes on delete cascade,
  lote_id uuid not null references lotes on delete cascade,
  quantidade integer not null check (quantidade > 0),
  preco_unit double precision not null,
  custo_unit double precision not null,
  em_promocao boolean not null default false
);

-- venda na loja ou online (com entrega e rastreio) – versão 5
alter table vendas add column if not exists canal text not null default 'loja';
alter table vendas add column if not exists entrega jsonb;
alter table vendas add column if not exists condicional_id uuid;

-- ---------- condicional: a cliente leva as peças para provar em casa
create table if not exists condicionais (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  cliente_id uuid not null references clientes on delete cascade,
  data timestamptz not null default now(),
  prazo date not null,
  itens jsonb not null,              -- [{variacao_id, quantidade, preco}]
  status text not null default 'aberta' check (status in ('aberta','fechada','cancelada')),
  fechada_em timestamptz,
  venda_id uuid,
  obs text
);

-- ---------- procuras: o que a cliente pediu e a loja não tinha (vendas perdidas) – versão 6
create table if not exists procuras (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  data timestamptz not null default now(),
  categoria text,
  descricao text,
  cor text,
  tamanho text,
  cliente_id uuid references clientes on delete set null,
  nome text,
  whatsapp text,
  status text not null default 'aberta' check (status in ('aberta','avisada','atendida','cancelada')),
  avisada_em timestamptz,
  produto_id uuid references produtos on delete set null
);

create index if not exists idx_variacoes_produto on variacoes (produto_id);
create index if not exists idx_lotes_variacao on lotes (variacao_id);
create index if not exists idx_vendas_data on vendas (owner_id, data);
create index if not exists idx_itens_venda on itens_venda (venda_id);

-- ---------- segurança: cada conta só vê o que é dela
do $$
declare t text;
begin
  foreach t in array array['config','produtos','variacoes','lotes','clientes','vendas','itens_venda','despesas','sonhos','aportes','relampagos','condicionais','procuras'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists dono on %I', t);
    execute format('create policy dono on %I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- registrar venda numa transação só (baixa o estoque dos lotes mais antigos primeiro)
-- p_itens: [{"variacao_id": "...", "quantidade": 2}, ...]
drop function if exists registrar_venda(uuid, text, uuid, double precision, jsonb);
create or replace function registrar_venda(
  p_id uuid, p_forma text, p_cliente uuid, p_desconto double precision, p_itens jsonb,
  p_canal text default 'loja', p_entrega jsonb default null, p_condicional uuid default null
) returns jsonb
language plpgsql security invoker as $$
declare
  it jsonb; falta integer; q integer; l record;
  v_total double precision := 0; v_custo double precision := 0; v_taxa double precision := 0;
  v_cfg config%rowtype; v_itens jsonb := '[]'::jsonb;
begin
  select * into v_cfg from config where owner_id = auth.uid();
  insert into vendas (id, forma_pagamento, cliente_id, total, custo_total, canal, entrega, condicional_id)
    values (p_id, p_forma, p_cliente, 0, 0, coalesce(p_canal, 'loja'), p_entrega, p_condicional);
  for it in select * from jsonb_array_elements(p_itens) loop
    falta := (it->>'quantidade')::integer;
    for l in select * from lotes
             where variacao_id = (it->>'variacao_id')::uuid and quantidade_atual > 0
             order by data_entrada, id for update loop
      exit when falta = 0;
      q := least(falta, l.quantidade_atual);
      update lotes set quantidade_atual = quantidade_atual - q where id = l.id;
      insert into itens_venda (id, venda_id, variacao_id, lote_id, quantidade, preco_unit, custo_unit, em_promocao)
        values (gen_random_uuid(), p_id, l.variacao_id, l.id, q,
                coalesce(l.preco_promocional, l.preco_venda), l.custo_unit, l.preco_promocional is not null);
      v_total := v_total + q * coalesce(l.preco_promocional, l.preco_venda);
      v_custo := v_custo + q * l.custo_unit;
      falta := falta - q;
    end loop;
    if falta > 0 then
      raise exception 'Estoque insuficiente para a peça %', it->>'codigo';
    end if;
  end loop;
  v_total := round((v_total - coalesce(p_desconto, 0))::numeric, 2);
  if p_forma in ('credito','debito') then
    v_taxa := round((v_total * coalesce(v_cfg.taxa_cartao_pct, 0) / 100)::numeric, 2);
  end if;
  update vendas set total = v_total, custo_total = round(v_custo::numeric, 2), taxa_pagamento = v_taxa
    where id = p_id;
  return jsonb_build_object('venda_id', p_id, 'total', v_total, 'custo', round(v_custo::numeric, 2),
                            'taxa_maquininha', v_taxa);
end $$;

-- ---------- fotos das peças (Storage). Leitura pública (para o flyer e o Instagram),
-- gravação só na pasta da própria conta: fotos/<id-da-conta>/arquivo.jpg
insert into storage.buckets (id, name, public)
  values ('fotos', 'fotos', true)
  on conflict (id) do update set public = true;

drop policy if exists "fotos_inserir" on storage.objects;
drop policy if exists "fotos_alterar" on storage.objects;
drop policy if exists "fotos_apagar" on storage.objects;
create policy "fotos_inserir" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos_alterar" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
