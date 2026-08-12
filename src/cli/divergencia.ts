/**
 * Roda as duas fontes uma vez e mede a diferenca entre elas.
 *
 * Mesmo caminho que o modo `ambos` executa a cada ciclo, mas sem Telegram —
 * da para rodar local com o Railway de pe (o loop principal nao, porque dois
 * pollers no mesmo token brigam por getUpdates).
 *
 * Serve para decidir com numero se vale trocar `fonteDeOdds`, e para conferir
 * adaptador novo: atraso de agregador aparece como divergencia pequena e
 * espalhada; adaptador com bug aparece como uma casa fora do padrao das outras.
 *
 * Atencao: custa uma varredura completa do Flashscore (~900 KB por jogo).
 */

import * as repo from '../db/repo.js';
import { varrer } from '../arb/scanner.js';
import { varrerDireto } from '../odds/scanner-direto.js';
import { compararTudo } from '../odds/divergencia.js';

async function main(): Promise<void> {
  const settings = await repo.lerSettings();
  const gravar = !process.argv.includes('--seco');

  console.log('Rodando as duas fontes... (a do Flashscore demora, ~900 KB por jogo)\n');

  const [antigo, direto] = await Promise.all([
    varrer({ settings, forcar: true }),
    varrerDireto({ settings }),
  ]);

  console.log(
    `flashscore: ${antigo.oddsPorJogo.size} jogo(s) com odds · ` +
      `direto: ${direto.oddsPorJogo.size} jogo(s), ${direto.casasConsultadas} casa(s)`,
  );
  for (const f of direto.casasComFalha) console.log(`  ! ${f.nome}: ${f.erro}`);

  const emComum = [...direto.oddsPorJogo.keys()].filter((id) => antigo.oddsPorJogo.has(id));
  const divs = compararTudo(antigo.oddsPorJogo, direto.oddsPorJogo);

  // Pernas comparadas: e o denominador honesto. Sem ele, "3 divergencias"
  // nao distingue 3 em 10 de 3 em 3000.
  let pernas = 0;
  for (const id of emComum) {
    const fs = new Set(antigo.oddsPorJogo.get(id)!.map((c) => c.bookmakerId));
    pernas += direto.oddsPorJogo.get(id)!.filter((c) => fs.has(c.bookmakerId)).length * 3;
  }

  console.log(`${emComum.length} jogo(s) nas duas fontes · ${pernas} perna(s) comparadas\n`);

  if (divs.length === 0) {
    console.log('Nenhuma divergencia acima do ruido de arredondamento.');
  } else {
    divs.sort((a, b) => b.desvioMaxPct - a.desvioMaxPct);
    console.log('divergencias (maior desvio primeiro):');
    for (const d of divs.slice(0, 20)) {
      console.log(
        `  ${d.nome.padEnd(16)} ${d.matchId}  ` +
          `fs ${d.fs.casa}/${d.fs.empate}/${d.fs.fora}  ` +
          `dir ${d.dir.casa}/${d.dir.empate}/${d.dir.fora}  ` +
          `desvio ${d.desvioMaxPct.toFixed(1)}%`,
      );
    }
    if (divs.length > 20) console.log(`  ... e mais ${divs.length - 20}`);

    // Uma casa concentrando a divergencia e suspeita de adaptador, nao de atraso.
    const porCasa = new Map<string, number>();
    for (const d of divs) porCasa.set(d.nome, (porCasa.get(d.nome) ?? 0) + 1);
    const ranking = [...porCasa.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\npor casa: ${ranking.map(([n, q]) => `${n} ${q}`).join(' · ')}`);
  }

  console.log(
    `\n${divs.length} divergencia(s) em ${pernas / 3 || 0} casa-jogo comparadas` +
      `${pernas > 0 ? ` (${((divs.length / (pernas / 3)) * 100).toFixed(1)}%)` : ''}`,
  );

  if (gravar) {
    const n = await repo.gravarDivergencias(divs);
    console.log(`${n} linha(s) gravadas em odds_divergencia. (--seco para nao gravar)`);
  } else {
    console.log('modo seco: nada gravado.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
