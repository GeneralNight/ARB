-- Mapas que ligam o catalogo do Flashscore ao catalogo de cada casa.
--
-- Os ids nao coincidem: o jogo `r9z6gEre` do Flashscore e o `13933710` na
-- Superbet, e "Man City" nao e "Manchester City". Estas duas tabelas guardam o
-- resultado do pareamento para que ele rode UMA VEZ por jogo, e nao a cada
-- ciclo — e, principalmente, para que seja auditavel: pareamento errado soma
-- odds de partidas diferentes e produz arbitragem que nao existe.

-- Campeonato: resolvido por temporada, nao por ciclo.
--
-- Serve dois propositos. Nas casas com busca por data, o id filtra o payload
-- para as ligas habilitadas. Nas casas que so respondem por liga, ele vira
-- parametro da URL.
create table if not exists bookmaker_competitions (
  bookmaker_id           integer not null references bookmakers(id) on delete cascade,
  competition_id         text    not null references competitions(id) on delete cascade,
  competition_id_casa    text    not null,
  score                  numeric(4,3),
  -- Curada: correcao manual do que a heuristica errou. Nenhum sync a sobrescreve.
  manual                 boolean not null default false,
  created_at             timestamptz not null default now(),
  primary key (bookmaker_id, competition_id)
);

comment on column bookmaker_competitions.manual is
  'Curada pelo usuario. Linha marcada como manual e verdade e NUNCA e sobrescrita pelo sync.';

-- Jogo: resolvido no upsert do calendario.
create table if not exists bookmaker_events (
  bookmaker_id   integer not null references bookmakers(id) on delete cascade,
  match_id       text    not null references matches(id) on delete cascade,
  event_id_casa  text    not null,
  score          numeric(4,3),
  -- 'betradar' = id externo bateu exato · 'nome' = heuristica · 'manual' = voce
  via            text    not null default 'nome',
  manual         boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (bookmaker_id, match_id)
);

comment on column bookmaker_events.manual is
  'Curada pelo usuario. Linha marcada como manual e verdade e NUNCA e sobrescrita pelo pareamento automatico.';

-- Busca do coletor: "todos os jogos que esta casa conhece", por ciclo.
create index if not exists bookmaker_events_match_idx on bookmaker_events (match_id);

-- Mesmo desenho de RLS do resto: nega tudo, service_role passa por cima.
alter table bookmaker_competitions enable row level security;
alter table bookmaker_events       enable row level security;
