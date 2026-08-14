/**
 * Adaptador da plataforma CT/Sportradar — Bet7k e afins.
 *
 * Nao cabe no motor declarativo por dois motivos independentes:
 *
 * 1. As odds vem em requisicao SEPARADA da lista de jogos. O motor pressupoe
 *    "lista de eventos com odds dentro"; aqui sao dois endpoints e uma juncao.
 * 2. Toda chamada exige credencial, entao o adaptador tem ESTADO — o primeiro
 *    do projeto. O Altenar e declarativo sao sem estado.
 *
 * O fluxo, verificado ao vivo em 14/08/2026 contra a Bet7k:
 *
 *   GET  {bootstrap}                      -> Set-Cookie: session, authorization
 *   POST /api/eventlist/eu/events/v2/all  -> 500 jogos, ~1,5 KB/jogo
 *   GET  /api/eventlist/eu/markets/all    -> odds, ~2,75 KB/jogo, ate 150 ids
 *
 * O token e ANONIMO (`customerType: "anon"`, `customerId: -1`) e vale 24h. Isto
 * e o que separa esta casa das de `cf_clearance`: o token e emitido por um GET
 * comum, nao arrancado de um navegador. Nao ha conta envolvida, entao nao ha
 * risco de limitacao de conta pela coleta.
 */

import { buscar, buscarJson } from '../../http/client.js';
import type { ConfigCt } from '../esquema.js';
import type { AdaptadorCasa, EventoDaCasa } from '../tipos.js';

/** Futebol na CT. */
const ESPORTE_FUTEBOL = '1';

/**
 * 1X2 tempo integral PRE-JOGO.
 *
 * `ML39` e `ML169` sao o mesmo mercado ao vivo — o mapa `marketColumns` do
 * bundle da casa separa `prelive: ["ML0"]` de `live: ["ML39","ML169"]`. Pedir o
 * codigo de live traria odds de jogo rolando, que nao e o que este robo aposta.
 */
const MERCADO_1X2_PREJOGO = 'ML0';

/**
 * Teto por requisicao da listagem.
 *
 * A oferta inteira da casa sao ~1520 jogos (medido: `limit` 3000 e 10000
 * devolvem o mesmo numero). Um dia cheio deu 728, entao 3000 e folga larga —
 * mas o adaptador ainda avisa se bater no teto, porque truncar em silencio
 * seria perder jogo sem ninguem notar.
 */
const LIMITE_JOGOS = 3000;

/**
 * Ids por requisicao de odds.
 *
 * 150 foi testado e passou (URL de 3,2 KB). 100 deixa margem para id mais
 * longo sem chegar perto do limite de URL de nenhum intermediario.
 */
const LOTE_MERCADOS = 100;

/** `Side` da cotacao. O proprio payload rotula: 1 Casa · 2 Empate · 3 Fora. */
const SIDE_CASA = 1;
const SIDE_EMPATE = 2;
const SIDE_FORA = 3;

/** Sufixo do `_id` da selecao — a segunda fonte do rotulo. */
const SUFIXO_POR_SIDE: Record<number, string> = {
  [SIDE_CASA]: 'H',
  [SIDE_EMPATE]: 'D',
  [SIDE_FORA]: 'A',
};

// ------------------------------------------------------------------- tipos

interface CtParticipante {
  Name?: string;
  VenueRole?: string;
}

export interface CtEvento {
  _id?: string;
  IsLive?: boolean;
  IsSuspended?: boolean;
  Type?: string;
  SportId?: string;
  LeagueId?: string;
  StartEventDate?: string;
  Participants?: CtParticipante[];
}

export interface CtRespostaEventos {
  data?: CtEvento[];
}

interface CtSelecao {
  _id?: string;
  Name?: string;
  Side?: number;
  IsDisabled?: boolean;
  IsRemoved?: boolean;
  DisplayOdds?: { Decimal?: string };
}

export interface CtMercado {
  EventId?: string;
  IsLive?: boolean;
  IsSuspended?: boolean;
  IsRemoved?: boolean;
  MarketType?: { _id?: string };
  Selections?: CtSelecao[];
}

/** A resposta de odds e um OBJETO com chaves "0","1","2"…, nao um array. */
export type CtRespostaMercados = Record<string, CtMercado> | CtMercado[];

/** Jogo ja extraido da listagem, ainda sem odds. */
export interface JogoCt {
  idNaCasa: string;
  mandante: string;
  visitante: string;
  kickoffUnix: number;
  competicaoNaCasa?: string;
}

// --------------------------------------------------------------- extracao

/**
 * Jogos da listagem. Descarta ao ARREDONDAR para menos, nunca para mais:
 * jogo sem os dois participantes rotulados nao vira palpite de quem e mandante.
 */
export function extrairJogosCt(resp: CtRespostaEventos): JogoCt[] {
  const jogos: JogoCt[] = [];

  for (const ev of resp.data ?? []) {
    if (!ev._id) continue;
    // Ao vivo nao interessa e ainda traz odds que mudam durante a coleta.
    if (ev.IsLive || ev.IsSuspended) continue;
    if (ev.Type && ev.Type !== 'Fixture') continue;
    if (ev.SportId && ev.SportId !== ESPORTE_FUTEBOL) continue;

    const mandante = ev.Participants?.find((p) => p.VenueRole === 'Home')?.Name;
    const visitante = ev.Participants?.find((p) => p.VenueRole === 'Away')?.Name;
    // `VenueRole` explicito e o motivo de esta casa nao poder inverter os
    // rotulos em silencio, ao contrario do Flashscore — onde a ordem de
    // aparicao era o unico sinal, e vinha invertida.
    if (!mandante || !visitante) continue;

    const kickoffUnix = Math.floor(Date.parse(ev.StartEventDate ?? '') / 1000);
    if (!Number.isFinite(kickoffUnix)) continue;

    jogos.push({
      idNaCasa: ev._id,
      mandante,
      visitante,
      kickoffUnix,
      competicaoNaCasa: ev.LeagueId,
    });
  }

  return jogos;
}

interface Pernas {
  casa: number;
  empate: number;
  fora: number;
  nomeCasa: string;
  nomeFora: string;
}

/** Normaliza a resposta de odds, que ora e objeto indexado, ora array. */
function mercadosDe(resp: CtRespostaMercados): CtMercado[] {
  return Array.isArray(resp) ? resp : Object.values(resp ?? {});
}

/**
 * Odds 1X2 por id de jogo.
 *
 * Trava contra inversao: `Side` e o sufixo do `_id` sao duas fontes
 * independentes do rotulo (`Side:1` <-> `…H`). Discordando, o mercado inteiro
 * cai — mesmo criterio do Altenar, e pela mesma razao: rotulo trocado nao muda
 * `S`, entao passaria por todo teste que so olha numero agregado.
 */
export function extrairOddsCt(resp: CtRespostaMercados): Map<string, Pernas> {
  const porJogo = new Map<string, Pernas>();

  for (const m of mercadosDe(resp)) {
    if (!m.EventId) continue;
    if (m.MarketType?._id !== MERCADO_1X2_PREJOGO) continue;
    if (m.IsSuspended || m.IsRemoved || m.IsLive) continue;

    const selecoes = m.Selections ?? [];
    if (selecoes.length !== 3) continue;

    const porSide = new Map<number, CtSelecao>();
    for (const s of selecoes) {
      if (s.Side === undefined) continue;
      // Duas selecoes do mesmo lado = payload que nao entendemos. Descartar.
      if (porSide.has(s.Side)) { porSide.clear(); break; }
      porSide.set(s.Side, s);
    }

    const casa = porSide.get(SIDE_CASA);
    const empate = porSide.get(SIDE_EMPATE);
    const fora = porSide.get(SIDE_FORA);
    if (!casa || !empate || !fora) continue;

    // Odd suspensa nao e apostavel — alertar arbitragem sobre perna morta e
    // pior que nao alertar.
    if ([casa, empate, fora].some((s) => s.IsDisabled || s.IsRemoved)) continue;

    // As duas fontes do rotulo precisam concordar.
    const rotuloBate = [casa, empate, fora].every(
      (s) => s._id?.endsWith(SUFIXO_POR_SIDE[s.Side!]!) ?? false,
    );
    if (!rotuloBate) continue;

    const precos = [casa, empate, fora].map((s) => Number(s.DisplayOdds?.Decimal));
    if (!precos.every((v) => Number.isFinite(v) && v > 1)) continue;

    porJogo.set(m.EventId, {
      casa: precos[0]!,
      empate: precos[1]!,
      fora: precos[2]!,
      nomeCasa: casa.Name ?? '',
      nomeFora: fora.Name ?? '',
    });
  }

  return porJogo;
}

/**
 * Junta listagem e odds, que vieram de requisicoes diferentes.
 *
 * A juncao confere o nome do mandante nos DOIS endpoints. Nao e zelo: um
 * desalinhamento de lote (odds do jogo errado coladas no jogo certo) e
 * silencioso por natureza, e produziria exatamente o tipo de alerta que manda
 * apostar no time errado pelo preco de outro.
 */
export function juntarCt(jogos: JogoCt[], odds: Map<string, Pernas>): EventoDaCasa[] {
  const eventos: EventoDaCasa[] = [];

  for (const j of jogos) {
    const p = odds.get(j.idNaCasa);
    if (!p) continue;
    if (p.nomeCasa !== j.mandante || p.nomeFora !== j.visitante) continue;

    eventos.push({
      idNaCasa: j.idNaCasa,
      mandante: j.mandante,
      visitante: j.visitante,
      kickoffUnix: j.kickoffUnix,
      competicaoNaCasa: j.competicaoNaCasa,
      casa: p.casa,
      empate: p.empate,
      fora: p.fora,
    });
  }

  return eventos;
}

// ------------------------------------------------------------------- rede

interface Credencial {
  Session: string;
  Authorization: string;
}

function cookie(cookies: string[], nome: string): string | undefined {
  const linha = cookies.find((c) => c.startsWith(`${nome}=`));
  return linha?.slice(nome.length + 1).split(';')[0];
}

/** Emite a sessao anonima. Um GET, sem navegador, sem conta. */
export async function emitirCredencial(config: ConfigCt): Promise<Credencial> {
  const resp = await buscar(config.host + config.bootstrap, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
  });
  const cookies = resp.headers.getSetCookie();
  const session = cookie(cookies, 'session');
  const authorization = cookie(cookies, 'authorization');
  if (!session || !authorization) {
    throw new Error(`${config.nome}: bootstrap nao emitiu token (${cookies.length} cookies)`);
  }
  return { Session: session, Authorization: authorization };
}

function headers(cred: Credencial, host: string): Record<string, string> {
  return {
    ...cred,
    Accept: 'application/json',
    Referer: host + '/',
    // Vazio de proposito: e o que o proprio site manda quando nao ha fuso
    // escolhido. Omitir o header muda a resposta.
    'time-area': '',
  };
}

/**
 * Listagem de um intervalo.
 *
 * `startDate`/`endDate` sao os UNICOS filtros de data que a CT respeita —
 * `dateFrom`/`dateTo`, `dateRange` e `period` sao aceitos e ignorados, e a
 * resposta volta com a oferta inteira. Medido: o intervalo de um dia traz
 * 32 KB contra 2,37 MB sem filtro.
 *
 * Conferido contra a lista completa fatiada localmente, em tres dias: o filtro
 * NUNCA perdeu jogo do intervalo. Ele devolve alguns a mais do dia seguinte
 * (a borda parece usar fuso local), e por isso quem chama continua fatiando.
 */
async function listarJogos(
  config: ConfigCt,
  cred: Credencial,
  inicioUnix: number,
  fimUnix: number,
): Promise<JogoCt[]> {
  const resp = await buscarJson<CtRespostaEventos>(`${config.host}/api/eventlist/eu/events/v2/all`, {
    headers: headers(cred, config.host),
    corpoJson: {
      sport: [ESPORTE_FUTEBOL],
      type: ['Fixture'],
      live: false,
      sortBy: 'time',
      limit: LIMITE_JOGOS,
      startDate: new Date(inicioUnix * 1000).toISOString(),
      endDate: new Date(fimUnix * 1000).toISOString(),
    },
  });

  const brutos = resp.data?.length ?? 0;
  if (brutos >= LIMITE_JOGOS) {
    console.warn(`[${config.nome}] listagem bateu no teto de ${LIMITE_JOGOS} — pode haver jogo cortado`);
  }
  return extrairJogosCt(resp);
}

async function buscarOdds(
  config: ConfigCt,
  cred: Credencial,
  ids: string[],
): Promise<Map<string, Pernas>> {
  const tudo = new Map<string, Pernas>();

  for (let i = 0; i < ids.length; i += LOTE_MERCADOS) {
    const lote = ids.slice(i, i + LOTE_MERCADOS);
    const alvo = encodeURIComponent(`${lote.join('|')}:${MERCADO_1X2_PREJOGO}`);
    const resp = await buscarJson<CtRespostaMercados>(
      `${config.host}/api/eventlist/eu/markets/all?markets=${alvo}`,
      { headers: headers(cred, config.host) },
    );
    for (const [id, pernas] of extrairOddsCt(resp)) tudo.set(id, pernas);
  }

  return tudo;
}

export function criarAdaptadorCt(config: ConfigCt, agora = new Date()): AdaptadorCasa {
  // Credencial emitida UMA vez por adaptador, e o adaptador vive um ciclo. Nao
  // ha tabela nem expiracao para gerenciar: o token vale 24h e o ciclo dura
  // minutos, entao renovar e mais barato que guardar.
  let credencial: Promise<Credencial> | null = null;
  // Cache POR DIA, ao contrario do Altenar: la a resposta vinha inteira porque
  // filtro de data nao funcionava, aqui funciona e pedir so o dia e 74x menor.
  const cacheJogos = new Map<number, Promise<JogoCt[]>>();

  const diaUtc = (deslocamento: number): number =>
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + deslocamento) / 1000;

  return {
    bookmakerId: config.bookmakerId,
    nome: config.nome,
    async listarDoDia(dia: number): Promise<EventoDaCasa[]> {
      const cred = await (credencial ??= emitirCredencial(config));

      const inicio = diaUtc(dia);
      const fim = diaUtc(dia + 1);

      let pedido = cacheJogos.get(dia);
      if (!pedido) {
        pedido = listarJogos(config, cred, inicio, fim);
        cacheJogos.set(dia, pedido);
      }

      // A borda do filtro do servidor vaza algumas horas do dia seguinte, entao
      // o corte de verdade e este aqui.
      const doDia = (await pedido).filter((j) => j.kickoffUnix >= inicio && j.kickoffUnix < fim);
      if (doDia.length === 0) return [];

      // Odds so dos jogos do dia: e o passo que mantem o custo baixo, porque
      // cobra por jogo (~2,75 KB) em vez de pela oferta inteira.
      const odds = await buscarOdds(config, cred, doDia.map((j) => j.idNaCasa));
      return juntarCt(doDia, odds);
    },
  };
}
