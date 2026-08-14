/**
 * Cliente HTTP do sistema de odds diretas.
 *
 * Nao e refatoracao de `src/flashscore/client.ts` — e um cliente separado, de
 * proposito. Os dois sistemas precisam poder quebrar sem levar o outro junto, e
 * este aqui tem uma exigencia que o outro nao tem: fala com ~27 hosts, entao o
 * disjuntor precisa ser POR HOST. Um 429 da Betano nao pode calar a Superbet.
 */

const TIMEOUT_MS = 20_000;
const TENTATIVAS = 3;

/** Espera minima depois de um 429/403, mesmo sem header Retry-After. */
const ESPERA_RATE_LIMIT_MS = 60_000;
/** Quanto tempo o disjuntor segura um host depois de apanhar. */
const DISJUNTOR_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ErroHttp extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'ErroHttp';
  }
}

export interface OpcoesBusca {
  headers?: Record<string, string>;
  /** Cookies ja resolvidos (ex.: cf_clearance colhido pelo porteiro). */
  cookie?: string;
  timeoutMs?: number;
  /**
   * Corpo JSON. Presente = POST.
   *
   * Existe porque a plataforma CT lista os jogos por POST
   * (`eventlist/eu/events/v2/all`). Passa pelo mesmo disjuntor por host que o
   * GET — o que protege a casa e o host, nao o verbo.
   */
  corpoJson?: unknown;
}

// ------------------------------------------------------- disjuntor por host

const bloqueadoAte = new Map<string, number>();

function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function hostBloqueado(url: string): boolean {
  return Date.now() < (bloqueadoAte.get(hostDe(url)) ?? 0);
}

export function segundosAteDesbloquear(url: string): number {
  const ate = bloqueadoAte.get(hostDe(url)) ?? 0;
  return Math.max(0, Math.ceil((ate - Date.now()) / 1000));
}

/** Visivel para log e para o teste; nao ha estado global escondido. */
export function hostsBloqueados(): string[] {
  const agora = Date.now();
  return [...bloqueadoAte.entries()].filter(([, ate]) => ate > agora).map(([host]) => host);
}

function acionarDisjuntor(url: string, ms: number): void {
  const host = hostDe(url);
  const ate = Date.now() + ms;
  if (ate > (bloqueadoAte.get(host) ?? 0)) {
    bloqueadoAte.set(host, ate);
    console.warn(`[http] ${host} bloqueado por ${Math.ceil(ms / 1000)}s (rate limit/bloqueio)`);
  }
}

/** So para teste: zera o disjuntor entre casos. */
export function limparDisjuntores(): void {
  bloqueadoAte.clear();
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

// ------------------------------------------------------------------- busca

/**
 * User-Agent padrao das casas.
 *
 * Fixo de proposito: o `cf_clearance` do Cloudflare e atrelado ao par IP + UA
 * que o obteve. Rotacionar UA invalidaria o cookie colhido pelo porteiro.
 */
export const UA_PADRAO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

export async function buscar(url: string, opcoes: OpcoesBusca = {}): Promise<Response> {
  if (hostBloqueado(url)) {
    throw new ErroHttp(
      `${hostDe(url)} em pausa (${segundosAteDesbloquear(url)}s restantes)`,
      429,
      url,
    );
  }

  const headers: Record<string, string> = {
    'User-Agent': UA_PADRAO,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    ...opcoes.headers,
  };
  if (opcoes.cookie) headers.Cookie = opcoes.cookie;

  const temCorpo = opcoes.corpoJson !== undefined;
  if (temCorpo) headers['Content-Type'] ??= 'application/json';

  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resp = await fetch(url, {
        method: temCorpo ? 'POST' : 'GET',
        body: temCorpo ? JSON.stringify(opcoes.corpoJson) : undefined,
        headers,
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_MS),
      });

      // Rate limit ou bloqueio: parar este host, nao so esta requisicao.
      if (resp.status === 429 || resp.status === 403) {
        acionarDisjuntor(url, Math.max(esperaSugerida(resp), DISJUNTOR_MS));
        throw new ErroHttp(`HTTP ${resp.status} — rate limit/bloqueio`, resp.status, url);
      }

      // 404 aqui e config errada (URL da casa mudou): retentar nao resolve.
      if (resp.status === 404) {
        throw new ErroHttp(`404 em ${url} — a URL da casa mudou?`, 404, url);
      }
      if (!resp.ok) throw new ErroHttp(`HTTP ${resp.status}`, resp.status, url);
      return resp;
    } catch (err) {
      ultimoErro = err;
      // 404 = configuracao errada · 429/403 = insistir piora. Sair na hora.
      if (err instanceof ErroHttp && [404, 429, 403].includes(err.status ?? 0)) throw err;
      if (tentativa < TENTATIVAS) await sleep(500 * 2 ** (tentativa - 1));
    }
  }

  throw new ErroHttp(`falhou apos ${TENTATIVAS} tentativas: ${String(ultimoErro)}`, undefined, url);
}

export async function buscarTexto(url: string, opcoes?: OpcoesBusca): Promise<string> {
  return (await buscar(url, opcoes)).text();
}

export async function buscarJson<T>(url: string, opcoes?: OpcoesBusca): Promise<T> {
  return (await buscar(url, opcoes)).json() as Promise<T>;
}

/**
 * Executa tarefas com concorrencia limitada, preservando a ordem do resultado.
 * Um erro numa tarefa vira `null` em vez de derrubar a coleta inteira.
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
