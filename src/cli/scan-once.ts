/**
 * Varredura unica, com a tabela de odds impressa no terminal.
 *
 * Serve para conferir o filtro de ligas: os contadores mostram quantos jogos
 * cairam em cada etapa, entao um filtro invertido aparece na hora em vez de
 * o robo varrer liga errada em silencio.
 */

import { montarAposta } from '../arb/calc.js';
import { varrer } from '../arb/scanner.js';
import * as repo from '../db/repo.js';
import { buscarOdds } from '../flashscore/odds.js';

async function main(): Promise<void> {
  const settings = await repo.lerSettings();
  const c = await repo.contarCompeticoes();

  console.log('Varredura unica\n');
  console.log(`banca ${settings.banca} · limiar ${settings.lucroMinimoPct}% · ` +
    `incremento ${settings.incrementoStake} · ${c.habilitadas}/${c.total} ligas habilitadas\n`);

  if (c.habilitadas === 0) {
    console.log('Nenhuma liga habilitada. No SQL Editor do Supabase:');
    console.log('  select * from v_competitions_pick;');
    console.log("  update competitions set enabled = true where id in ('Yq4hUnzQ');");
    console.log('\nSe o catalogo estiver vazio, rode antes: npm run sync:competitions');
    return;
  }

  const r = await varrer({ settings, forcar: true });

  const janela =
    settings.janelaDias === 0
      ? 'hoje'
      : settings.janelaDias === 1
        ? 'hoje + amanha'
        : `hoje + ${settings.janelaDias} dias`;

  console.log('Funil de filtragem:');
  console.log(`  jogos no feed (${janela})`.padEnd(33, '.') + ` ${r.jogosNoFeed}`);
  console.log(`  das ligas habilitadas ......... ${r.aposFiltroDeLiga}`);
  console.log(`  ainda pre-jogo ................ ${r.aposFiltroPreJogo}`);
  console.log(`  varridos (forcado) ............ ${r.aposCadencia}`);
  console.log(`  com odds 1X2 .................. ${r.comOdds}${r.erros ? `   (${r.erros} erros)` : ''}`);

  if (r.aposFiltroDeLiga === 0 && r.jogosNoFeed > 0) {
    console.log(`\nNenhum jogo (${janela}) pertence as ligas habilitadas.`);
    console.log('Normal se as ligas escolhidas nao jogam nesse periodo.');
    console.log('Para varrer mais dias a frente: /janela 2 no Telegram.');
    return;
  }

  if (r.linhas.length > 0) {
    console.log('\nMelhor linha por jogo (3 casas distintas):\n');
    const ordenadas = [...r.linhas].sort((a, b) => a.linha.margemPct - b.linha.margemPct);

    for (const { jogo, linha } of ordenadas) {
      const marca = linha.margemPct < 0 ? ' ← ARBITRAGEM' : '';
      console.log(`  ${jogo.mandante} x ${jogo.visitante}  (${jogo.ligaNome})`);
      console.log(
        `    casa   ${String(linha.casa.odd).padStart(6)}  ${linha.casa.nome}\n` +
          `    empate ${String(linha.empate.odd).padStart(6)}  ${linha.empate.nome}\n` +
          `    fora   ${String(linha.fora.odd).padStart(6)}  ${linha.fora.nome}`,
      );
      console.log(
        `    S = ${linha.s.toFixed(5)}  margem ${linha.margemPct.toFixed(2)}%  ` +
          `(${linha.bookCount} casas)${marca}\n`,
      );
    }
  }

  if (r.oportunidades.length === 0) {
    console.log(`Nenhuma oportunidade acima do limiar de ${settings.lucroMinimoPct}%.`);
    if (settings.lucroMinimoPct >= 0) {
      console.log('Dica: /min -1 no Telegram mostra tambem os quase-arbs, para calibrar.');
    }
    return;
  }

  console.log(`${r.oportunidades.length} oportunidade(s) acima do limiar:\n`);
  console.log('  (diagnostico: nao grava em arb_alerts nem envia Telegram — quem faz isso e o npm start)\n');
  for (const op of r.oportunidades) {
    console.log(`  ${op.jogo.mandante} x ${op.jogo.visitante} — ROI ${op.aposta.roiPct.toFixed(2)}%`);
    for (const p of op.aposta.pernas) {
      console.log(
        `    ${p.resultado.padEnd(6)} ${p.nome.padEnd(20)} @${p.odd.toFixed(2)}  ` +
          `R$ ${p.stake.toFixed(2)}  → R$ ${p.retorno.toFixed(2)}`,
      );
    }
    console.log(`    total R$ ${op.aposta.total.toFixed(2)}  lucro R$ ${op.aposta.lucroPiorCaso.toFixed(2)}\n`);
  }
}

/** Modo direto: `npm run scan:once -- <eventId>` inspeciona um jogo especifico. */
async function jogoUnico(eventId: string): Promise<void> {
  const settings = await repo.lerSettings();
  console.log(`Inspecionando o jogo ${eventId}...\n`);

  const odds = await buscarOdds(eventId);
  if (!odds || odds.casas.length === 0) {
    console.log('Sem odds 1X2 para este jogo.');
    return;
  }

  console.log(`${odds.casas.length} casas com 1X2 tempo integral:\n`);
  for (const c of odds.casas) {
    const s = 1 / c.casa + 1 / c.empate + 1 / c.fora;
    console.log(
      `  ${c.nome.padEnd(22)} ${String(c.casa).padStart(6)} ${String(c.empate).padStart(6)} ` +
        `${String(c.fora).padStart(6)}   juice ${((s - 1) * 100).toFixed(2)}%`,
    );
  }

  const { bestLine } = await import('../arb/calc.js');
  const linha = bestLine(odds.casas);
  if (!linha) return;

  console.log(`\nMelhor linha combinada:`);
  console.log(`  casa   ${linha.casa.odd}  ${linha.casa.nome}`);
  console.log(`  empate ${linha.empate.odd}  ${linha.empate.nome}`);
  console.log(`  fora   ${linha.fora.odd}  ${linha.fora.nome}`);
  console.log(`  S = ${linha.s.toFixed(5)}  margem ${linha.margemPct.toFixed(2)}%`);

  const aposta = montarAposta(linha, settings.banca, settings.incrementoStake);
  console.log(`  ROI pos-arredondamento: ${aposta.roiPct.toFixed(2)}%  ` +
    `(${aposta.isArb ? 'ARBITRAGEM' : 'sem arbitragem'})`);
}

const arg = process.argv[2];
const executar = arg ? jogoUnico(arg) : main();
executar.catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
