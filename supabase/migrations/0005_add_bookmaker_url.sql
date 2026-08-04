-- Link da casa para o alerta do Telegram.
--
-- O Flashscore nao expoe URL: o payload de odds traz so id, nome e cores de
-- bonus (verificado na fixture). O site monta o link no cliente, por um
-- redirecionador de afiliado que nao vale reproduzir. Entao a coluna e curada
-- por voce, igual has_account/max_stake, e upsertCasas nunca a toca.
alter table bookmakers add column if not exists url text;

comment on column bookmakers.url is
  'Curada pelo usuario. Home da casa, usada como link no alerta do Telegram. NUNCA sobrescrever em upsert automatico.';
