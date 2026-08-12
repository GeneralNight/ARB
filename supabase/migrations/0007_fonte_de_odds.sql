-- Seletor entre os dois sistemas de odds, e o que o sistema novo precisa.
--
-- `fonteDeOdds` fica em `settings` — tabela relida a cada ciclo — para que
-- virar a chave valha no minuto seguinte, sem restart e sem redeploy. Padrao
-- 'flashscore': quem nao configurar nada continua com o comportamento de hoje.
insert into settings (key, value)
values ('fonteDeOdds', '"flashscore"'::jsonb)
on conflict (key) do nothing;

-- Config declarativa por casa. O BANCO e a fonte da verdade, nao o git.
--
-- Motivo: o painel (Supabase hoje, Nuxt depois) precisa editar URL e extracao
-- sem deploy. Os arquivos em src/odds/casas/*.json sao semente e alvo dos
-- testes; `npm run config:exportar` traz o banco de volta para eles, para que
-- config quebrada pelo painel tenha historico em git e possa ser revertida.
--
-- Tabela inteiramente curada: nenhum upsert automatico escreve aqui. A validacao
-- zod acontece na LEITURA — config invalida tira aquela casa do ciclo, com log,
-- sem derrubar a varredura.
create table if not exists bookmaker_configs (
  bookmaker_id integer primary key references bookmakers(id) on delete cascade,
  config       jsonb   not null,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);

comment on table bookmaker_configs is
  'Curada pelo usuario/painel. Nenhum sync automatico escreve aqui. Validada por zod na leitura.';

-- Cookies e headers volateis (cf_clearance, User-Agent que o obteve).
--
-- Separada da config porque gira em outro ritmo: config muda quando a casa muda
-- de API, isto muda quando o Cloudflare expira o desafio. Misturar poluiria o
-- historico da config com rotacao de cookie.
--
-- O cf_clearance e atrelado ao par IP + User-Agent que o emitiu: guardar o UA
-- junto nao e redundancia, e requisito.
create table if not exists bookmaker_auth (
  bookmaker_id integer primary key references bookmakers(id) on delete cascade,
  cookie       text,
  user_agent   text,
  updated_at   timestamptz not null default now()
);

comment on table bookmaker_auth is
  'Curada pelo usuario/porteiro. cf_clearance e atrelado a IP + User-Agent: os dois andam juntos.';

-- De qual sistema veio cada leitura.
--
-- Sem isto o historico vira mistura nao interpretavel: o baseline empirico do
-- projeto (juice 4,9%-10,3%, melhor linha 1,89%) foi medido com odds do
-- Flashscore, e comparar com odds diretas sem saber qual e qual nao significa nada.
alter table line_scans add column if not exists source text not null default 'flashscore';
alter table arb_alerts add column if not exists source text not null default 'flashscore';

-- Divergencia entre as duas fontes, gravada so quando diverge (modo 'ambos').
--
-- E a medicao continua do problema que originou este trabalho: quanto o
-- Flashscore erra, casa a casa. Serve tambem de detector de bug de adaptador —
-- divergencia muito fora do padrao das outras e erro de parser, nao atraso do
-- agregador.
create table if not exists odds_divergencia (
  id           bigserial primary key,
  match_id     text    not null references matches(id) on delete cascade,
  bookmaker_id integer not null references bookmakers(id) on delete cascade,
  scanned_at   timestamptz not null default now(),
  fs_casa      numeric(8,2),
  fs_empate    numeric(8,2),
  fs_fora      numeric(8,2),
  dir_casa     numeric(8,2),
  dir_empate   numeric(8,2),
  dir_fora     numeric(8,2)
);

-- Mesma limpeza de 30 dias de line_scans: e diagnostico, nao registro contabil.
create index if not exists odds_divergencia_scanned_idx on odds_divergencia (scanned_at);

alter table bookmaker_configs enable row level security;
alter table bookmaker_auth    enable row level security;
alter table odds_divergencia  enable row level security;
