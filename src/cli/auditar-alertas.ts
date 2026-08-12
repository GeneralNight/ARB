/**
 * Reprocessa alertas ja gravados com o filtro de outlier ligado.
 *
 * Responde "quantos dos alertas que o robo mandou eram artefato de odd
 * defasada?" usando `full_snapshot`, que guarda as odds de TODAS as casas no
 * momento do alerta. Nao altera nada — so relê.
 *
 *   npm run auditar -- [limiarPct]
 */

import * as repo from '../db/repo.js';
import { bestLine, filtrarOutliers, montarAposta, type OddsCasa } from '../arb/calc.js';
import { db } from '../db/client.js';

async function main(): Promise<void> {
  const limiar = Number(process.argv[2] ?? 25);
  const settings = await repo.lerSettings();

  const { data, error } = await db()
    .from('arb_alerts')
    .select('id, match_id, roi_pct, full_snapshot, detected_at')
    .order('roi_pct', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const jogos = new Map<string, string>();
  const ids = [...new Set((data ?? []).map((a) => a.match_id as string))];
  if (ids.length > 0) {
    const m = await db().from('matches').select('id, home, away').in('id', ids);
    for (const j of m.data ?? []) jogos.set(j.id as string, `${j.home} x ${j.away}`);
  }

  console.log(`Reprocessando ${data?.length ?? 0} alertas com limiar de ${limiar}%...\n`);

  let sobrevivem = 0;
  let somem = 0;
  let semSnapshot = 0;
  const mortos: Array<{ jogo: string; antes: number; depois: string; odd: number; med: number }> = [];

  for (const a of data ?? []) {
    const snapshot = a.full_snapshot as OddsCasa[] | null;
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      semSnapshot++;
      continue;
    }

    const filtro = filtrarOutliers(snapshot, limiar);
    const linha = bestLine(filtro.mantidas);
    const roiAntes = Number(a.roi_pct);

    if (!linha) {
      somem++;
      mortos.push({
        jogo: jogos.get(a.match_id as string) ?? (a.match_id as string),
        antes: roiAntes,
        depois: 'sem linha',
        odd: filtro.descartadas[0]?.odd ?? 0,
        med: filtro.descartadas[0]?.mediana ?? 0,
      });
      continue;
    }

    const aposta = montarAposta(linha, settings.banca, settings.incrementoStake);
    if (aposta.roiPct > 0) {
      sobrevivem++;
    } else {
      somem++;
      mortos.push({
        jogo: jogos.get(a.match_id as string) ?? (a.match_id as string),
        antes: roiAntes,
        depois: `${aposta.roiPct.toFixed(2)}%`,
        odd: filtro.descartadas[0]?.odd ?? 0,
        med: filtro.descartadas[0]?.mediana ?? 0,
      });
    }
  }

  console.log('alertas que SOMEM com o filtro (eram artefato de odd defasada):');
  for (const m of mortos.slice(0, 15)) {
    console.log(
      `  ${m.jogo.padEnd(38).slice(0, 38)} ROI ${m.antes.toFixed(2).padStart(7)}% -> ${m.depois}` +
        (m.odd ? `   (odd ${m.odd} vs mediana ${m.med.toFixed(2)})` : ''),
    );
  }
  if (mortos.length > 15) console.log(`  ... e mais ${mortos.length - 15}`);

  const total = sobrevivem + somem;
  console.log(
    `\n${somem} de ${total} alertas somem (${total ? ((somem / total) * 100).toFixed(0) : 0}%) · ` +
      `${sobrevivem} sobrevivem${semSnapshot ? ` · ${semSnapshot} sem snapshot` : ''}`,
  );
  console.log('Nada foi alterado — auditoria apenas.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
