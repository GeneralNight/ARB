/**
 * Lista os jogos de hoje que ainda nao comecaram, agrupados por liga.
 *
 * Util para escolher o que habilitar: mostra onde ainda ha tempo de agir hoje.
 *   npm run proximos
 */

import { apenasPreJogo, buscarFeedDoDia } from '../flashscore/feed.js';
import { ligasHabilitadas } from '../db/repo.js';

async function main(): Promise<void> {
  const feed = await buscarFeedDoDia(0);
  const restantes = apenasPreJogo(feed.jogos, 5);

  console.log(`${feed.jogos.length} jogos hoje · ${restantes.length} ainda nao comecaram\n`);
  if (restantes.length === 0) {
    console.log('Nada mais hoje. Os jogos de amanha entram no feed a partir da virada.');
    return;
  }

  let habilitadas: Set<string>;
  try {
    habilitadas = await ligasHabilitadas();
  } catch {
    habilitadas = new Set();
  }

  const porLiga = new Map<string, typeof restantes>();
  for (const j of restantes) {
    const atual = porLiga.get(j.ligaId) ?? [];
    atual.push(j);
    porLiga.set(j.ligaId, atual);
  }

  const ordenadas = [...porLiga.entries()].sort(
    (a, b) => a[1][0]!.kickoff.getTime() - b[1][0]!.kickoff.getTime(),
  );

  for (const [ligaId, jogos] of ordenadas) {
    const marca = habilitadas.has(ligaId) ? '✓' : ' ';
    console.log(`${marca} ${ligaId}  ${jogos[0]!.ligaNome}`);
    for (const j of jogos) {
      const hora = j.kickoff.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
      console.log(`      ${hora}  ${j.mandante} x ${j.visitante}   (${j.id})`);
    }
  }

  console.log('\n✓ = liga ja habilitada. Para habilitar outra:');
  console.log("  update competitions set enabled = true where id = '<id>';");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
