/**
 * Adaptador da plataforma Altenar — nove casas brasileiras de uma vez.
 *
 * BateuBet, BR4Bet, Brasildasorte, Esportivabet, F12, Goldebet, Jogo de Ouro,
 * Lotogreen e LuvaBet rodam no mesmo backend; muda so o `integration`.
 *
 * Nao cabe no motor declarativo porque a resposta e RELACIONAL: `events`,
 * `markets`, `odds` e `competitors` vem em arrays separados, ligados por id.
 * Montar um jogo exige junção em tres saltos (evento -> mercado -> cotacoes -> nomes).
 *
 * Verificado ao vivo em 12/08/2026 contra `integration=esportiva`.
 */

import { buscarJson } from '../../http/client.js';
import type { AdaptadorCasa, EventoDaCasa } from '../tipos.js';

const HOST = 'https://sb2frontend-altenar2.biahosted.com/api/widget/GetEvents';

/** Futebol no Altenar. */
const SPORT_ID = 66;

/** "Vencedor do encontro" — o 1X2 tempo integral. */
const MERCADO_1X2 = 1;

/**
 * Tipos de cotacao dentro do mercado 1, conforme o proprio `headers` da resposta:
 * `{"typeId":1,"odds":[{"id":1,"name":"1"},{"id":2,"name":"X"},{"id":3,"name":"2"}]}`
 */
const TIPO_CASA = 1;
const TIPO_EMPATE = 2;
const TIPO_FORA = 3;

/** `oddStatus` 0 = valendo. Cotacao suspensa nao e apostavel. */
const ODD_ATIVA = 0;

interface AltenarOdd {
  id: number;
  typeId: number;
  price: number;
  oddStatus: number;
  competitorId?: number;
}
interface AltenarMarket {
  id: number;
  typeId: number;
  oddIds: number[];
}
interface AltenarEvent {
  id: number;
  startDate: string;
  competitorIds: number[];
  marketIds: number[];
  champId: number;
  extId?: string;
}
interface AltenarResp {
  events?: AltenarEvent[];
  markets?: AltenarMarket[];
  odds?: AltenarOdd[];
  competitors?: Array<{ id: number; name: string }>;
}

function url(integration: string, champIds: string[]): string {
  const p = new URLSearchParams({
    sportId: String(SPORT_ID),
    culture: 'pt-BR',
    timezoneOffset: '-180',
    integration,
    deviceType: '1',
    numFormat: 'en-GB',
    countryCode: 'BR',
  });
  // Sem filtro a resposta e a oferta inteira: ~2,7 MB e 1083 jogos. Com as
  // ligas mapeadas cai para ~52 KB. A primeira coleta de cada casa paga o
  // preco cheio (e como as ligas sao descobertas); da segunda em diante, nao.
  if (champIds.length > 0) p.set('champIds', champIds.join(','));
  return `${HOST}?${p}`;
}

/** `fp32_ar:match:597011` -> `597011`. */
function idSportradar(extId: string | undefined): string | undefined {
  const m = /match:(\d+)/.exec(extId ?? '');
  return m?.[1];
}

export function extrairAltenar(resp: AltenarResp): EventoDaCasa[] {
  const odds = new Map((resp.odds ?? []).map((o) => [o.id, o]));
  const mercados = new Map((resp.markets ?? []).map((m) => [m.id, m]));
  const nomes = new Map((resp.competitors ?? []).map((c) => [c.id, c.name]));

  const eventos: EventoDaCasa[] = [];
  for (const ev of resp.events ?? []) {
    const [idCasa, idFora] = ev.competitorIds ?? [];
    const mandante = idCasa === undefined ? undefined : nomes.get(idCasa);
    const visitante = idFora === undefined ? undefined : nomes.get(idFora);
    if (!mandante || !visitante) continue;

    const kickoffUnix = Math.floor(Date.parse(ev.startDate) / 1000);
    if (!Number.isFinite(kickoffUnix)) continue;

    const mercado = (ev.marketIds ?? [])
      .map((id) => mercados.get(id))
      .find((m) => m?.typeId === MERCADO_1X2);
    if (!mercado) continue;

    const doMercado = mercado.oddIds.map((id) => odds.get(id)).filter((o): o is AltenarOdd => !!o);
    const casa = doMercado.find((o) => o.typeId === TIPO_CASA);
    const empate = doMercado.find((o) => o.typeId === TIPO_EMPATE);
    const fora = doMercado.find((o) => o.typeId === TIPO_FORA);
    if (!casa || !empate || !fora) continue;

    if ([casa, empate, fora].some((o) => o.oddStatus !== ODD_ATIVA)) continue;

    // Trava contra inversao de mandante/visitante.
    //
    // Ha duas fontes independentes de quem e a casa: a ordem em
    // `event.competitorIds` e o `competitorId` da cotacao tipo 1. Se
    // discordarem, uma das duas suposicoes esta errada e nao da para saber
    // qual — entao o jogo e descartado em vez de chutado.
    //
    // Este projeto ja perdeu tempo com exatamente esse bug do lado do
    // Flashscore, onde nao havia segunda fonte para conferir. Aqui ha.
    if (casa.competitorId !== undefined && casa.competitorId !== idCasa) continue;
    if (fora.competitorId !== undefined && fora.competitorId !== idFora) continue;

    const precos = [casa.price, empate.price, fora.price].map(Number);
    if (!precos.every((v) => Number.isFinite(v) && v > 1)) continue;

    eventos.push({
      idNaCasa: String(ev.id),
      mandante,
      visitante,
      kickoffUnix,
      competicaoNaCasa: ev.champId === undefined ? undefined : String(ev.champId),
      betradarId: idSportradar(ev.extId),
      casa: precos[0]!,
      empate: precos[1]!,
      fora: precos[2]!,
    });
  }
  return eventos;
}

const diaUtc = (base: Date, deslocamento: number): number =>
  Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + deslocamento) / 1000;

export function criarAdaptadorAltenar(
  config: { bookmakerId: number; nome: string; integration: string },
  champIds: string[] = [],
  agora = new Date(),
): AdaptadorCasa {
  // O Altenar devolve TODAS as datas numa resposta e nao aceita filtro de data
  // (testados `dateFrom`/`dateTo`, `startDate`/`endDate`, `period`: todos
  // ignorados). Entao busca uma vez e fatia por dia em memoria — sem isto,
  // varrer uma janela de 3 dias baixaria o mesmo payload 3 vezes.
  let cache: Promise<EventoDaCasa[]> | null = null;

  return {
    bookmakerId: config.bookmakerId,
    nome: config.nome,
    async listarDoDia(dia: number): Promise<EventoDaCasa[]> {
      cache ??= buscarJson<AltenarResp>(url(config.integration, champIds)).then(extrairAltenar);
      const todos = await cache;
      const inicio = diaUtc(agora, dia);
      const fim = diaUtc(agora, dia + 1);
      return todos.filter((e) => e.kickoffUnix >= inicio && e.kickoffUnix < fim);
    },
  };
}
