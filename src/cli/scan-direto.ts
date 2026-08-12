/**
 * Uma varredura pelo sistema de odds diretas, com o funil no terminal.
 *
 * Equivalente do `scan:once` para o pipeline novo. Nao envia Telegram e nao
 * depende do setting `fonteDeOdds` — serve justamente para conferir o sistema
 * direto antes de virar a chave.
 *
 * Atencao: `varrerDireto` ESCREVE (upsertJogos, line_scans, pareamentos).
 */

import * as repo from '../db/repo.js';
import { varrerDireto } from '../odds/scanner-direto.js';

async function main(): Promise<void> {
  const settings = await repo.lerSettings();
  const { configs, rejeitadas } = await repo.configsDeCasas();

  console.log(
    `fonte atual no banco: ${settings.fonteDeOdds} · ` +
      `${configs.length} casa(s) com adaptador: ${configs.map((c) => c.nome).join(', ') || '(nenhuma)'}`,
  );
  for (const r of rejeitadas) console.log(`  ! config invalida na casa ${r.bookmakerId}: ${r.erro}`);
  if (configs.length === 0) {
    console.log('\nNenhuma casa configurada. Use `npm run importar:curl` para adicionar.');
    return;
  }

  const r = await varrerDireto({ settings });

  console.log(
    `\nfeed ${r.jogosNoFeed} → liga habilitada ${r.aposFiltroDeLiga} → ` +
      `pre-jogo ${r.aposFiltroPreJogo} → com odds ${r.comOdds}`,
  );
  console.log(
    `casas consultadas ${r.casasConsultadas} · eventos vistos ${r.eventosVistos} · ` +
      `line_scans gravados ${r.aposCadencia}`,
  );
  for (const f of r.casasComFalha) console.log(`  ! ${f.nome}: ${f.erro}`);

  // Um "com odds 0" seco confunde: parece adaptador quebrado quando e so
  // aritmetica. `bestLine` exige tres casas DISTINTAS — com duas ou menos nao
  // existe arbitragem 1X2, existe uma casa generosa.
  if (r.comOdds === 0 && configs.length < 3) {
    console.log(
      `\n  Nenhum jogo pontuou porque so ha ${configs.length} casa(s) com adaptador.\n` +
        '  Arbitragem 1X2 precisa de 3 casas distintas — abaixo disso o sistema\n' +
        '  direto e sempre silencioso. Virar `fonteDeOdds` para `direto` agora\n' +
        '  calaria o robo. Configure pelo menos 3 casas antes.',
    );
  }

  if (r.linhas.length > 0) {
    console.log('\nmelhor linha por jogo:');
    for (const { jogo, linha } of r.linhas.slice(0, 12)) {
      console.log(
        `  ${(jogo.mandante + ' x ' + jogo.visitante).padEnd(42).slice(0, 42)} ` +
          `${linha.casa.odd.toFixed(2).padStart(6)} ${linha.empate.odd.toFixed(2).padStart(6)} ` +
          `${linha.fora.odd.toFixed(2).padStart(6)}  margem ${linha.margemPct.toFixed(2)}%` +
          `  (${linha.bookCount} casas)`,
      );
    }
    if (r.linhas.length > 12) console.log(`  ... e mais ${r.linhas.length - 12}`);
  }

  console.log(
    r.oportunidades.length > 0
      ? `\n${r.oportunidades.length} oportunidade(s) acima do limiar de ${settings.lucroMinimoPct}%`
      : `\nnenhuma oportunidade acima do limiar de ${settings.lucroMinimoPct}%`,
  );
  console.log('(diagnostico: nao gravou arb_alerts nem enviou Telegram)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
