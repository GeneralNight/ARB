-- RLS habilitado SEM nenhuma policy: nega tudo por padrao.
--
-- O bot local usa a chave service_role, que ignora RLS. Assim, se a chave
-- anon/publishable vazar, ela nao le absolutamente nada.
--
-- O linter do Supabase vai reportar "RLS Enabled No Policy" (nivel INFO) para
-- todas estas tabelas. Isso e o comportamento pretendido, nao um problema.
-- Policies de leitura so entram se um dia houver dashboard web.

alter table competitions enable row level security;
alter table bookmakers  enable row level security;
alter table matches     enable row level security;
alter table line_scans  enable row level security;
alter table arb_alerts  enable row level security;
alter table settings    enable row level security;
