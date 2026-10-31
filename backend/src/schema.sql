create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id bigserial primary key,
  source text not null,                -- 'pluggy', 'manual' ou 'extrato-inicial'
  external_id text,
  date date not null,
  bank text,
  description text not null,
  amount numeric(14,2) not null,       -- positivo = entrada, negativo = saída
  category text not null default 'Outros',
  category_manual boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists transactions_date_idx on transactions (date desc);

create table if not exists orders (
  id bigserial primary key,
  external_id text not null unique,
  placed_at timestamptz not null,
  channel text not null,
  status text,
  canceled boolean not null default false,
  gross numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  fee numeric(14,2) not null default 0,
  net numeric(14,2) not null,
  updated_at timestamptz not null default now()
);
create index if not exists orders_placed_idx on orders (placed_at desc);

-- payload bruto de todo webhook recebido, para reprocessar se o formato mudar
create table if not exists webhook_events (
  id bigserial primary key,
  source text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  processed boolean not null default false,
  error text
);

create table if not exists rules (
  id bigserial primary key,
  pattern text not null,
  category text not null,
  position int not null default 100
);

create table if not exists sync_log (
  source text primary key,
  last_run timestamptz,
  last_ok timestamptz,
  message text
);

-- fotos anexadas a lançamentos feitos pelo celular (nota de compra, boleto): guardadas no próprio
-- Postgres, não em disco, pra entrarem de graça no backup diário que já existe.
create table if not exists attachments (
  id bigserial primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

-- notas de insumos: uma linha por item comprado
create table if not exists supplies (
  id bigserial primary key,
  date date not null,
  invoice text not null default '',
  supplier text not null default '',
  product text not null default '',
  brand text not null default '',
  unit text not null default 'un',
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists supplies_date_idx on supplies (date desc);
alter table supplies add column if not exists photo_id bigint references attachments(id);
