/**
 * Popula o catalogo de competicoes varrendo os feeds de -1 a +7 dias.
 *
 * So DESCOBRE ligas — nao baixa odds, entao e barato. Tudo entra com
 * enabled = false; habilitar e curadoria sua, no painel do Supabase.
 *
 * O upsert nunca toca em `enabled`: rodar isto de novo nao apaga suas escolhas.
 */

import { buscarFeedDoDia, type Liga } from '../flashscore/feed.js';
import * as repo from '../db/repo.js';

const DIA_INICIAL = -1;
const DIA_FINAL = 7;

async function main(): Promise<void> {
  console.log(`Descobrindo competicoes (dias ${DIA_INICIAL} a ${DIA_FINAL})...\n`);

  const todas = new Map<string, Liga>();

  for (let dia = DIA_INICIAL; dia <= DIA_FINAL; dia++) {
    try {
      const feed = await buscarFeedDoDia(dia);
      let novas = 0;
      for (const liga of feed.ligas) {
        if (!todas.has(liga.id)) {
          todas.set(liga.id, liga);
          novas++;
        }
      }
      console.log(
        `  dia ${String(dia).padStart(2)}: ${String(feed.ligas.length).padStart(3)} ligas, ` +
          `${String(feed.jogos.length).padStart(3)} jogos  (+${novas} novas)  acumulado ${todas.size}`,
      );
    } catch (err) {
      console.log(`  dia ${String(dia).padStart(2)}: falhou — ${err instanceof Error ? err.message : err}`);
    }
  }

  const antes = await repo.contarCompeticoes();
  await repo.upsertCompeticoes([...todas.values()]);
  const depois = await repo.contarCompeticoes();

  console.log(`\n${todas.size} competicoes enviadas ao banco.`);
  console.log(`Catalogo: ${antes.total} → ${depois.total} competicoes`);
  console.log(`Habilitadas: ${depois.habilitadas} (inalterado pelo sync)`);

  if (depois.habilitadas === 0) {
    console.log('\nNenhuma liga habilitada ainda. No SQL Editor do Supabase:');
    console.log('  select * from v_competitions_pick;');
    console.log("  update competitions set enabled = true where id in ('Yq4hUnzQ', 'vRtLP6rs');");
    console.log('  -- Yq4hUnzQ = Brasileirao Betano, vRtLP6rs = Serie B');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
