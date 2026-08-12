-- Filtro de odd fora de mercado.
--
-- Em 07/08/2026 o robo alertou "arbitragem" de 25,95% em Botafogo x Fluminense:
-- 5,50 numa perna enquanto o resto do mercado precificava ~3,25. Isso nao e
-- preco, e odd velha que o agregador nao atualizou — o risco nº 1 do projeto
-- virando alerta. Arbitragem 1X2 real vive entre 0,1% e 2%.
--
-- Descarta a casa cuja odd passe deste % acima da mediana das outras. `0`
-- desliga. So o lado ALTO e filtrado: odd baixa demais nunca cria arbitragem
-- falsa, so aumenta S. Por isso o filtro nunca inventa arbitragem, so suprime.
insert into settings (key, value)
values ('filtroOutlierPct', '25'::jsonb)
on conflict (key) do nothing;
