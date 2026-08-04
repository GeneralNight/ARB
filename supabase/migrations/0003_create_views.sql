-- security_invoker: a view respeita o RLS de quem consulta, em vez de rodar
-- com os privilegios do dono. Sem isso, uma view furaria o "nega tudo".

-- O que existe para escolher. E aqui que voce liga/desliga ligas.
create view v_competitions_pick
with (security_invoker = true) as
select id, name, country, enabled, last_seen_at
from competitions
order by enabled desc, name;

-- "Vale a pena arriscar dinheiro nisso?"
-- ainda_existiam / ja_tinham_sumido vem dos botoes do Telegram e medem o
-- atraso real das odds do Flashscore — o risco numero 1 do projeto.
create view v_arb_summary
with (security_invoker = true) as
select date_trunc('day', detected_at)::date      as dia,
       count(*)                                  as alertas,
       round(avg(roi_pct), 2)                    as roi_medio,
       round(max(roi_pct), 2)                    as roi_max,
       count(*) filter (where confirmed)         as ainda_existiam,
       count(*) filter (where confirmed = false) as ja_tinham_sumido,
       count(*) filter (where bet_placed)        as apostados
from arb_alerts
group by 1
order by 1 desc;

-- Quase-arbs: o quanto falta para virar oportunidade de verdade.
create view v_near_misses
with (security_invoker = true) as
select m.home, m.away, c.name as liga, m.kickoff,
       ls.margin_pct, ls.book_count, ls.scanned_at
from line_scans ls
join matches m           on m.id = ls.match_id
left join competitions c on c.id = m.competition_id
where ls.margin_pct < 2
order by ls.margin_pct asc
limit 100;
