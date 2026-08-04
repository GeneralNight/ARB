-- lucroMinimoPct comeca em -1 de proposito (modo calibracao).
--
-- Arbitragem 1X2 de 3 vias e rara. Com o limiar em 0 voce pode passar dias sem
-- receber nada — e nao conseguiria distinguir "nao apareceu oportunidade" de
-- "o robo quebrou e nao avisou". Em -1 ele apita tambem nos quase-arbs; depois
-- de calibrar, suba para o valor com que pretende operar (/min 1.5).

insert into settings (key, value) values
  ('banca',                '1000'),
  ('lucroMinimoPct',       '-1'),
  ('incrementoStake',      '1'),
  ('somenteCasasComConta', 'false'),
  ('minutosAntesDoInicio', '5'),
  ('pausado',              'false')
on conflict (key) do nothing;
