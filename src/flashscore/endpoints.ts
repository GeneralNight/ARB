/**
 * Endpoints internos do Flashscore (nao sao API publica documentada).
 *
 * Todos verificados com resposta real em 03/08/2026. Se algo aqui mudar, o
 * `npm run doctor` acusa e o README explica como redescobrir os valores.
 */

/** flashscore.com.br. O .com internacional e o projectId 2. */
export const PROJECT_ID = 401;

/** Assinatura fixa exigida pelo feed. Constante do bundle do site. */
export const FSIGN = 'SW9D1eZo';

/**
 * Hash da persisted query de odds (findOddsByEventId).
 * O endpoint so aceita hashes pre-registrados: qualquer outro valor responde
 * `404 Query not stored`. Esse 404 e justamente o sinal de que o hash mudou.
 */
export const ODDS_HASH = 'oce';

export const GEO = { code: 'BR', subdivision: 'BRSP' } as const;

export const BASE_HEADERS: Record<string, string> = {
  'x-fsign': FSIGN,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  Referer: 'https://www.flashscore.com.br/',
  Origin: 'https://www.flashscore.com.br',
};

/**
 * Feed de jogos de um dia. `dia` e relativo a hoje: 0 = hoje, 1 = amanha,
 * -1 = ontem. O robo usa apenas o dia 0; o sync de catalogo varre -1..+7.
 */
export function feedDoDiaUrl(dia: number): string {
  return `https://${PROJECT_ID}.flashscore.ninja/${PROJECT_ID}/x/feed/f_1_${dia}_3_pt-br_1`;
}

/** Comparacao de odds de um jogo, com todas as casas. ~900 KB por chamada. */
export function oddsUrl(eventId: string): string {
  const p = new URLSearchParams({
    _hash: ODDS_HASH,
    eventId,
    projectId: String(PROJECT_ID),
    geoIpCode: GEO.code,
    geoIpSubdivisionCode: GEO.subdivision,
  });
  return `https://global.ds.lsapp.eu/pq_graphql?${p}`;
}

/** Link do jogo no site, para o alerta do Telegram. */
export function matchUrl(eventId: string): string {
  return `https://www.flashscore.com.br/jogo/${eventId}/`;
}

/** Portugues do Brasil na API de busca. */
export const LANG_ID = 31;

/**
 * Busca de competicoes por nome.
 *
 * Serve para achar liga que o feed diario nao mostra: o feed so cobre -1..+7
 * dias (de +8 em diante devolve vazio), entao liga em pre-temporada some do
 * catalogo. A busca enxerga o ano inteiro.
 *
 * Confirmado que os ids sao os MESMOS do feed: buscar "brasileirao" devolve
 * `Yq4hUnzQ`, identico ao ZEE que o feed traz.
 */
export function buscaUrl(termo: string): string {
  const p = new URLSearchParams({
    q: termo,
    'lang-id': String(LANG_ID),
    'project-id': String(PROJECT_ID),
    'project-type-id': '1',
    'sport-ids': '1',
    'type-ids': '1', // 1 = TournamentTemplate (competicao)
  });
  return `https://s.livesport.services/api/v2/search/?${p}`;
}
