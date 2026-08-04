-- Espelho da migration aplicada no projeto ARB (fkahtqqlznhrwkenenve).
--
-- Contrato de curadoria: as colunas abaixo sao SUAS e nenhum sync automatico
-- as sobrescreve — competitions.enabled, bookmakers.has_account,
-- bookmakers.max_stake, bookmakers.note.

create table competitions (
  id           text primary key,               -- ZEE do feed do Flashscore
  name         text not null,
  url_path     text,
  country      text,
  enabled      boolean not null default false, -- curadoria manual
  last_seen_at timestamptz not null default now()
);
create index competitions_enabled_idx on competitions (enabled) where enabled;

create table bookmakers (
  id           integer primary key,            -- id do Flashscore (16=bet365, 574=Betano.br)
  name         text not null,
  has_account  boolean not null default false, -- curadoria manual
  max_stake    numeric,                        -- limite pratico observado
  note         text,
  last_seen_at timestamptz not null default now()
);

create table matches (
  id             text primary key,             -- AA do feed
  competition_id text references competitions(id),
  home           text not null,
  away           text not null,
  kickoff        timestamptz not null,
  last_scan_at   timestamptz,
  scan_count     integer not null default 0
);
create index matches_kickoff_idx on matches (kickoff);
create index matches_competition_idx on matches (competition_id);

-- Uma linha leve por varredura, mesmo sem arbitragem.
-- Responde "quao perto chegamos" ao longo do tempo.
create table line_scans (
  id             bigserial primary key,
  match_id       text not null references matches(id) on delete cascade,
  scanned_at     timestamptz not null default now(),
  s              numeric(8,5) not null,        -- soma dos inversos das odds
  margin_pct     numeric(6,3) not null,        -- (s-1)*100; negativo = arbitragem
  best_home      numeric(8,2),
  best_home_book integer,
  best_draw      numeric(8,2),
  best_draw_book integer,
  best_away      numeric(8,2),
  best_away_book integer,
  book_count     integer
);
create index line_scans_match_idx on line_scans (match_id, scanned_at desc);
create index line_scans_margin_idx on line_scans (margin_pct);
create index line_scans_scanned_at_idx on line_scans (scanned_at);

-- Disparou alerta: foto completa do momento, para auditoria posterior.
create table arb_alerts (
  id            bigserial primary key,
  match_id      text not null references matches(id) on delete cascade,
  dedupe_key    text not null unique,          -- match_id + trio de casas
  detected_at   timestamptz not null default now(),
  s             numeric(8,5) not null,
  roi_pct       numeric(6,3) not null,         -- ja pos-arredondamento
  bankroll      numeric(12,2) not null,
  legs          jsonb not null,
  profit        numeric(12,2) not null,
  full_snapshot jsonb not null,                -- todas as casas no instante
  notified_at   timestamptz,
  -- preenchidos por voce, pelos botoes do Telegram:
  confirmed     boolean,                       -- a odd ainda existia na casa?
  bet_placed    boolean not null default false,
  actual_profit numeric(12,2),
  notes         text
);
create index arb_alerts_detected_idx on arb_alerts (detected_at desc);

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
