/**
 * Prova de vida do adaptador CT, ao vivo e sem banco.
 *
 * Le a config da semente em `src/odds/casas/*.json`, nao de `bookmaker_configs`
 * — de proposito: separa "a casa mudou de formato" de "a config no banco esta
 * torta", que sao problemas diferentes com o mesmo sintoma.
 */

import { readFileSync } from 'node:fs';
import { criarAdaptadorCt } from '../odds/casas/ct.js';
import { validarConfig } from '../odds/esquema.js';

const bruto = JSON.parse(readFileSync('src/odds/casas/bet7k.json', 'utf8'));
const r = validarConfig(bruto);
if (!r.ok) {
  console.error('config invalida:', r.erro);
  process.exit(1);
}
if (r.config.plataforma !== 'ct') {
  console.error('config nao e da plataforma ct');
  process.exit(1);
}

const adaptador = criarAdaptadorCt(r.config);

for (const dia of [0, 1]) {
  const inicio = Date.now();
  const eventos = await adaptador.listarDoDia(dia);
  const ms = Date.now() - inicio;
  console.log(`\n=== dia ${dia}: ${eventos.length} jogos com 1X2 (${ms} ms) ===`);

  for (const e of eventos.slice(0, 6)) {
    const s = 1 / e.casa + 1 / e.empate + 1 / e.fora;
    const hora = new Date(e.kickoffUnix * 1000).toISOString().slice(11, 16);
    console.log(
      `${hora}  ${e.mandante} x ${e.visitante}  ` +
        `${e.casa} / ${e.empate} / ${e.fora}  juice ${((s - 1) * 100).toFixed(2)}%`,
    );
  }

  if (eventos.length > 0) {
    const juices = eventos.map((e) => (1 / e.casa + 1 / e.empate + 1 / e.fora - 1) * 100);
    const min = Math.min(...juices);
    const media = juices.reduce((a, b) => a + b, 0) / juices.length;
    console.log(`juice: melhor ${min.toFixed(2)}%  media ${media.toFixed(2)}%`);
  }
}
