/**
 * Confere a ordem dos participantes no payload de odds do Flashscore.
 *
 * A ordem ja virou duas vezes (12/08 e 14/08/2026) e e o unico sinal de quem e
 * mandante — nao ha `homeAway` nem `side` no payload. Este comando mostra a
 * mediana de cada participante entre as casas, entao num jogo de favorito
 * obvio da para ler a direcao a olho: o azarao em casa e o participante #1.
 *
 * Complementa `npm run divergencia`, que mede em escala mas precisa das casas
 * diretas de pe. Este aqui roda com uma requisicao so.
 */

import { buscarJson } from '../flashscore/client.js';
import { oddsUrl } from '../flashscore/endpoints.js';

const eventId = process.argv[2] ?? 'KWjl4hph';
const resp = await buscarJson<any>(oddsUrl(eventId));
const oc = resp.data?.findOddsByEventId;

const linhas = (oc?.odds ?? []).filter(
  (o: any) => o.bettingType === 'HOME_DRAW_AWAY' && o.bettingScope === 'FULL_TIME',
);
console.log(`${eventId}: ${linhas.length} linhas 1X2`);

const ordem: string[] = [];
for (const l of linhas) {
  for (const it of l.odds) {
    if (it.eventParticipantId && !ordem.includes(it.eventParticipantId)) ordem.push(it.eventParticipantId);
  }
}
console.log(`ordem de aparicao dos participantes: ${ordem.join(' , ')}`);

// Mediana da odd de cada participante entre as casas: quem e o favorito.
const valores = new Map<string, number[]>();
for (const l of linhas) {
  for (const it of l.odds) {
    const chave = it.eventParticipantId ?? '(empate)';
    if (!valores.has(chave)) valores.set(chave, []);
    valores.get(chave)!.push(Number(it.value));
  }
}
for (const [chave, vs] of valores) {
  const ord = [...vs].sort((a, b) => a - b);
  const mediana = ord[Math.floor(ord.length / 2)];
  const posicao = ordem.indexOf(chave);
  const rotulo = chave === '(empate)' ? 'empate' : `participante #${posicao + 1}`;
  console.log(`  ${rotulo.padEnd(16)} ${chave.padEnd(12)} mediana ${mediana}  (${vs.length} casas)`);
}
