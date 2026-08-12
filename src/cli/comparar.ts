/**
 * Flashscore x odd direta da casa, lado a lado.
 *
 * E o teste de aceitacao de cada adaptador novo e a resposta ao problema que
 * originou este trabalho ("as odds do Flashscore nao batem com o site"). Com a
 * casa aberta no navegador, a coluna "direto" tem que bater NA HORA.
 *
 *   npm run comparar            -> todos os jogos da janela
 *   npm run comparar -- <id>    -> um jogo do Flashscore
 */

import { bestLine } from '../arb/calc.js';
import * as repo from '../db/repo.js';
import { buscarOdds } from '../flashscore/odds.js';
import { jogosDaJanela } from '../odds/calendario.js';
import { coletarOdds } from '../odds/coletor.js';

const fmt = (n: number) => n.toFixed(2).padStart(6);

async function main(): Promise<void> {
  const alvo = process.argv[2];
  const settings = await repo.lerSettings();

  const cal = await jogosDaJanela(settings);
  const jogos = alvo ? cal.jogos.filter((j) => j.id === alvo) : cal.jogos;

  if (jogos.length === 0) {
    console.log(
      alvo
        ? `Jogo ${alvo} nao esta na janela (liga habilitada? ja comecou?).`
        : 'Nenhum jogo na janela.',
    );
    return;
  }

  console.log(`Comparando ${jogos.length} jogo(s) da janela...\n`);

  const coleta = await coletarOdds(jogos);

  for (const r of coleta.configsRejeitadas) {
    console.log(`  ! config invalida na casa ${r.bookmakerId}: ${r.erro}`);
  }
  for (const f of coleta.casasComFalha) {
    console.log(`  ! ${f.nome} falhou: ${f.erro}`);
  }
  console.log(
    `casas consultadas: ${coleta.casasConsultadas} · eventos vistos: ${coleta.eventosVistos} · ` +
      `jogos pareados: ${coleta.jogosPareados}/${jogos.length}\n`,
  );

  let comparados = 0;
  let somaDiff = 0;
  let pernas = 0;
  let piorDiff = 0;

  for (const jogo of jogos) {
    const diretas = coleta.porJogo.get(jogo.id);
    if (!diretas || diretas.length === 0) continue;

    const fs = await buscarOdds(jogo.id);
    if (!fs) continue;

    const porCasaFs = new Map(fs.casas.map((c) => [c.bookmakerId, c]));
    const emComum = diretas.filter((d) => porCasaFs.has(d.bookmakerId));
    if (emComum.length === 0) continue;

    comparados++;
    console.log(`${jogo.mandante} x ${jogo.visitante}   [${jogo.ligaNome}]  ${jogo.id}`);
    console.log('  casa                 fonte     casa  empate    fora');

    for (const direta of emComum) {
      const doFs = porCasaFs.get(direta.bookmakerId)!;
      console.log(
        `  ${direta.nome.padEnd(18)} flashscore ${fmt(doFs.casa)}  ${fmt(doFs.empate)}  ${fmt(doFs.fora)}`,
      );
      console.log(
        `  ${''.padEnd(18)} direto     ${fmt(direta.casa)}  ${fmt(direta.empate)}  ${fmt(direta.fora)}`,
      );

      const diffs = [
        direta.casa - doFs.casa,
        direta.empate - doFs.empate,
        direta.fora - doFs.fora,
      ];
      const sinal = (d: number) => (d === 0 ? '     =' : (d > 0 ? '+' : '') + d.toFixed(2));
      console.log(
        `  ${''.padEnd(18)} dif        ${diffs.map((d) => sinal(d).padStart(6)).join('  ')}`,
      );

      for (const d of diffs) {
        // Diferenca relativa: 0,10 numa odd 1,20 e muito pior que numa odd 12,00.
        const rel = Math.abs(d) / doFs.casa;
        somaDiff += Math.abs(d);
        piorDiff = Math.max(piorDiff, rel);
        pernas++;
      }
    }

    // O que de fato muda a decisao: a melhor linha de cada fonte.
    const linhaFs = bestLine(fs.casas);
    const linhaDir = bestLine(diretas);
    if (linhaFs && linhaDir) {
      console.log(
        `  melhor linha  flashscore margem ${linhaFs.margemPct.toFixed(2)}% (${linhaFs.bookCount} casas)` +
          `  ·  direto margem ${linhaDir.margemPct.toFixed(2)}% (${linhaDir.bookCount} casas)`,
      );
    }
    console.log('');
  }

  if (comparados === 0) {
    console.log('Nenhum jogo teve a mesma casa nas duas fontes — nada a comparar ainda.');
    console.log('Se so a Superbet tem adaptador, o jogo precisa te-la no Flashscore tambem.');
    return;
  }

  console.log(
    `${comparados} jogo(s) comparados · ${pernas} pernas · ` +
      `diferenca media ${(somaDiff / pernas).toFixed(3)} · pior desvio relativo ${(piorDiff * 100).toFixed(1)}%`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
