/**
 * Valida os endpoints internos do Flashscore.
 *
 * Eles nao sao API publica: podem mudar quando o site atualizar. Rode isto
 * primeiro sempre que o robo parar de achar odds. O README explica como
 * redescobrir os valores quando algo aqui falhar.
 */

import { bestLine } from '../arb/calc.js';
import { buscarJson, buscarTexto } from '../flashscore/client.js';
import { ODDS_HASH, PROJECT_ID, feedDoDiaUrl, oddsUrl } from '../flashscore/endpoints.js';
import { parseFeed } from '../flashscore/feed.js';
import { parseOdds } from '../flashscore/odds.js';

let falhas = 0;

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const falha = (msg: string) => {
  falhas++;
  console.log(`  ✗ ${msg}`);
};

async function checarFeed(): Promise<string | null> {
  console.log(`\n[1/2] Feed de jogos  (projectId ${PROJECT_ID})`);
  console.log(`      ${feedDoDiaUrl(0)}`);
  try {
    const raw = await buscarTexto(feedDoDiaUrl(0));
    ok(`respondeu ${(raw.length / 1024).toFixed(0)} KB`);

    const feed = parseFeed(raw);
    if (feed.ligas.length === 0) {
      falha('nenhuma liga extraida — o formato do feed provavelmente mudou');
      return null;
    }
    ok(`${feed.ligas.length} ligas, ${feed.jogos.length} jogos`);

    const comKickoff = feed.jogos.filter((j) => !Number.isNaN(j.kickoff.getTime()));
    if (comKickoff.length !== feed.jogos.length) {
      falha(`${feed.jogos.length - comKickoff.length} jogos sem horario valido`);
    } else {
      ok('todos os jogos com horario valido');
    }

    return feed.jogos[0]?.id ?? null;
  } catch (err) {
    falha(String(err instanceof Error ? err.message : err));
    return null;
  }
}

async function checarOdds(eventId: string): Promise<void> {
  console.log(`\n[2/2] Odds  (_hash=${ODDS_HASH}, jogo ${eventId})`);
  console.log(`      ${oddsUrl(eventId)}`);
  try {
    const json = await buscarJson<unknown>(oddsUrl(eventId));
    const tamanho = JSON.stringify(json).length;
    ok(`respondeu ${(tamanho / 1024).toFixed(0)} KB`);

    const odds = parseOdds(json as never);
    if (!odds) {
      falha('findOddsByEventId ausente — a persisted query mudou de formato');
      return;
    }
    if (odds.casas.length === 0) {
      console.log('  ~ nenhuma casa com 1X2 neste jogo (comum em liga obscura)');
      return;
    }
    ok(`${odds.casas.length} casas com 1X2 tempo integral`);

    const semNome = odds.casas.filter((c) => c.nome.startsWith('#'));
    if (semNome.length > 0) falha(`${semNome.length} casas sem nome — settings.bookmakers mudou`);
    else ok('nomes das casas resolvidos');

    // Conferencia de geolocalizacao. Importa ao rodar fora do Brasil (Railway
    // e afins): se o geo vier errado, o numero de casas continua parecendo
    // saudavel, mas sao casas de outro pais e voce nao tem conta em nenhuma.
    const nomes = odds.casas.map((c) => c.nome);
    console.log(`      casas: ${nomes.slice(0, 8).join(', ')}${nomes.length > 8 ? ', ...' : ''}`);

    const brasileiras = nomes.filter((n) =>
      /\.br\b|bet365|betano|superbet|estrela|betnacional|kto|novibet|betesporte|galera|bateu/i.test(n),
    );
    if (brasileiras.length >= 3) {
      ok(`geo BR confirmado (${brasileiras.length} casas brasileiras reconhecidas)`);
    } else {
      falha(
        `geo suspeito: so ${brasileiras.length} casas brasileiras reconhecidas — ` +
          'rodando fora do Brasil com geoIpCode errado?',
      );
    }

    const linha = bestLine(odds.casas);
    if (linha) {
      ok(
        `melhor linha: ${linha.casa.odd} / ${linha.empate.odd} / ${linha.fora.odd} ` +
          `→ margem ${linha.margemPct.toFixed(2)}%${linha.margemPct < 0 ? '  ARBITRAGEM!' : ''}`,
      );
    }
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    falha(msg);
    if (msg.includes('404')) {
      console.log('\n      "Query not stored" = o hash da persisted query mudou.');
      console.log('      Veja "Quando o Flashscore quebrar" no README para redescobrir.');
    }
  }
}

async function main(): Promise<void> {
  console.log('Verificando os endpoints do Flashscore...');

  const eventId = await checarFeed();
  if (eventId) await checarOdds(eventId);
  else console.log('\n[2/2] Odds — pulado: o feed nao devolveu nenhum jogo.');

  console.log(
    falhas === 0
      ? '\nTudo certo: os endpoints estao respondendo como esperado.\n'
      : `\n${falhas} problema(s) encontrado(s). Veja o README.\n`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
