/**
 * Cliente HTTP para os endpoints do Flashscore.
 *
 * E API nao oficial: a postura aqui e conservadora de proposito — timeout
 * curto, poucas tentativas, pausa entre requisicoes e concorrencia limitada.
 */

import { BASE_HEADERS } from './endpoints.js';

export class FlashscoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'FlashscoreError';
  }
}

const TIMEOUT_MS = 20_000;
const TENTATIVAS = 3;

/** Espera minima depois de um 429/403, mesmo sem header Retry-After. */
const ESPERA_RATE_LIMIT_MS = 60_000;
/** Quanto tempo o disjuntor segura todas as requisicoes depois de apanhar. */
const DISJUNTOR_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Disjuntor global.
 *
 * Se o Flashscore responder 429 (rate limit) ou 403 (bloqueio), insistir e a
 * pior reacao possivel — vira bloqueio prolongado de IP. Aqui todas as
 * requisicoes param por alguns minutos assim que o primeiro sinal aparece.
 */
let bloqueadoAte = 0;

export function estaBloqueado(): boolean {
  return Date.now() < bloqueadoAte;
}

export function segundosAteDesbloquear(): number {
  return Math.max(0, Math.ceil((bloqueadoAte - Date.now()) / 1000));
}

function acionarDisjuntor(ms: number): void {
  const ate = Date.now() + ms;
  if (ate > bloqueadoAte) {
    bloqueadoAte = ate;
    console.warn(
      `[flashscore] rate limit detectado — pausando tudo por ${Math.ceil(ms / 1000)}s`,
    );
  }
}

/** Retry-After vem em segundos ou como data HTTP. */
function esperaSugerida(resp: Response): number {
  const h = resp.headers.get('retry-after');
  if (!h) return ESPERA_RATE_LIMIT_MS;
  const seg = Number(h);
  if (Number.isFinite(seg)) return Math.max(seg * 1000, ESPERA_RATE_LIMIT_MS);
  const data = Date.parse(h);
  return Number.isFinite(data)
    ? Math.max(data - Date.now(), ESPERA_RATE_LIMIT_MS)
    : ESPERA_RATE_LIMIT_MS;
}

async function buscar(url: string): Promise<Response> {
  if (estaBloqueado()) {
    throw new FlashscoreError(
      `em pausa por rate limit (${segundosAteDesbloquear()}s restantes)`,
      429,
      url,
    );
  }

  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: BASE_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Rate limit ou bloqueio: parar TUDO, nao so esta requisicao.
      if (resp.status === 429 || resp.status === 403) {
        acionarDisjuntor(Math.max(esperaSugerida(resp), DISJUNTOR_MS));
        throw new FlashscoreError(`HTTP ${resp.status} — rate limit/bloqueio`, resp.status, url);
      }

      // 404 num pq_graphql significa hash invalido: retentar nao resolve.
      if (resp.status === 404) {
        throw new FlashscoreError(
          `404 em ${url} — se for pq_graphql, o hash da persisted query mudou (rode: npm run doctor)`,
          404,
          url,
        );
      }
      if (!resp.ok) throw new FlashscoreError(`HTTP ${resp.status}`, resp.status, url);
      return resp;
    } catch (err) {
      ultimoErro = err;
      // 404 = configuracao errada · 429/403 = insistir piora. Sair na hora.
      if (err instanceof FlashscoreError && [404, 429, 403].includes(err.status ?? 0)) throw err;
      if (tentativa < TENTATIVAS) await sleep(500 * 2 ** (tentativa - 1));
    }
  }

  throw new FlashscoreError(
    `falhou apos ${TENTATIVAS} tentativas: ${String(ultimoErro)}`,
    undefined,
    url,
  );
}

export async function buscarTexto(url: string): Promise<string> {
  return (await buscar(url)).text();
}

export async function buscarJson<T>(url: string): Promise<T> {
  return (await buscar(url)).json() as Promise<T>;
}

/**
 * Executa tarefas com concorrencia limitada, preservando a ordem do resultado.
 * Um erro numa tarefa vira `null` em vez de derrubar a varredura inteira.
 */
export async function comLimite<T>(
  tarefas: Array<() => Promise<T>>,
  limite: number,
  pausaMs = 150,
): Promise<Array<T | null>> {
  const resultados: Array<T | null> = new Array(tarefas.length).fill(null);
  let proximo = 0;

  const worker = async () => {
    while (proximo < tarefas.length) {
      const i = proximo++;
      try {
        resultados[i] = await tarefas[i]!();
      } catch {
        resultados[i] = null;
      }
      if (pausaMs > 0) await sleep(pausaMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, worker));
  return resultados;
}
