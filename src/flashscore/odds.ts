/**
 * Normalizacao das odds 1X2 vindas do GraphQL do Flashscore.
 *
 * O payload traz ~420 entradas de mercado (~900 KB) e usamos so uma fatia:
 * bettingType HOME_DRAW_AWAY com bettingScope FULL_TIME. Nao da para filtrar
 * no servidor porque e persisted query — o formato e fixo.
 *
 * Dentro de cada entrada, os tres itens sao identificados assim:
 *   eventParticipantId === id do mandante  -> Casa
 *   eventParticipantId === id do visitante -> Fora
 *   eventParticipantId === null            -> Empate
 */

import type { OddsCasa } from '../arb/calc.js';
import { buscarJson } from './client.js';
import { oddsUrl } from './endpoints.js';

interface EventOddsItem {
  eventParticipantId: string | null;
  value: string;
  active: boolean;
}

interface EventOdds {
  bookmakerId: number;
  bettingType: string;
  bettingScope: string;
  odds: EventOddsItem[];
}

interface OddsResponse {
  data?: {
    findOddsByEventId?: {
      eventId: string;
      settings?: { bookmakers?: Array<{ bookmaker?: { id: number; name: string } }> };
      odds?: EventOdds[];
    } | null;
  };
}

export interface OddsDoJogo {
  eventId: string;
  casas: OddsCasa[];
  /** Payload cru das linhas 1X2, guardado no alerta para auditoria posterior. */
  snapshot: Array<{ bookmakerId: number; nome: string; casa: number; empate: number; fora: number }>;
}

/** settings.bookmakers[].bookmaker.{id,name} -> Map<id, nome> */
function mapaDeCasas(resp: OddsResponse): Map<number, string> {
  const lista = resp.data?.findOddsByEventId?.settings?.bookmakers ?? [];
  const mapa = new Map<number, string>();
  for (const item of lista) {
    if (item.bookmaker) mapa.set(item.bookmaker.id, item.bookmaker.name);
  }
  return mapa;
}

export function parseOdds(resp: OddsResponse): OddsDoJogo | null {
  const oc = resp.data?.findOddsByEventId;
  if (!oc) return null;

  const nomes = mapaDeCasas(resp);
  const linhas = (oc.odds ?? []).filter(
    (o) => o.bettingType === 'HOME_DRAW_AWAY' && o.bettingScope === 'FULL_TIME',
  );

  // Os ids de participante nao vem rotulados — nao ha `participantId`,
  // `homeAway` nem `side` em lugar nenhum do payload (conferido). A ordem de
  // aparicao e o unico sinal, e ela e VISITANTE primeiro, mandante depois.
  //
  // Estava invertido ate 12/08/2026. O erro se escondia bem: como todas as
  // casas vinham espelhadas juntas, `bestLine` continuava achando a arbitragem
  // certa (S e a soma dos tres maximos; trocar dois rotulos nao muda a soma) e
  // o ROI saia correto. So o ALERTA mentia — mandava apostar no mandante pelo
  // preco do visitante, e a arbitragem morria na hora de executar.
  //
  // Descoberto comparando com a odd direta da Superbet: nos 19 jogos pareados,
  // os 19 tinham empate identico e casa/fora trocados. Confirmado por sentido
  // futebolistico em Copenhagen x Debrecen (1,19 x 11,00), Hearts x Benfica e
  // Rangers x Jagiellonia.
  const participantes: string[] = [];
  for (const linha of linhas) {
    for (const item of linha.odds) {
      if (item.eventParticipantId && !participantes.includes(item.eventParticipantId)) {
        participantes.push(item.eventParticipantId);
      }
    }
  }
  const [idVisitante, idMandante] = participantes;
  if (!idMandante || !idVisitante) return null;

  const casas: OddsCasa[] = [];
  for (const linha of linhas) {
    const mandante = linha.odds.find((o) => o.eventParticipantId === idMandante);
    const visitante = linha.odds.find((o) => o.eventParticipantId === idVisitante);
    const empate = linha.odds.find((o) => o.eventParticipantId === null);
    if (!mandante || !visitante || !empate) continue;

    // Odd suspensa nao e apostavel: usar seria alertar algo inexistente.
    if (!mandante.active || !visitante.active || !empate.active) continue;

    const casa = Number(mandante.value);
    const emp = Number(empate.value);
    const fora = Number(visitante.value);
    if (![casa, emp, fora].every((v) => Number.isFinite(v) && v > 1)) continue;

    casas.push({
      bookmakerId: linha.bookmakerId,
      nome: nomes.get(linha.bookmakerId) ?? `#${linha.bookmakerId}`,
      casa,
      empate: emp,
      fora,
    });
  }

  return {
    eventId: oc.eventId,
    casas,
    snapshot: casas.map((c) => ({ ...c })),
  };
}

export async function buscarOdds(eventId: string): Promise<OddsDoJogo | null> {
  return parseOdds(await buscarJson<OddsResponse>(oddsUrl(eventId)));
}
