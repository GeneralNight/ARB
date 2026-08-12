/**
 * Executa a config declarativa de uma casa.
 *
 * Tudo aqui e puro menos `criarAdaptador`, que so amarra a busca HTTP na ponta.
 * A extracao e pura porque e onde um erro custa dinheiro: nome de time trocado
 * vira pareamento errado, e pareamento errado soma odds de jogos diferentes —
 * arbitragem fantasma. Puro = testavel contra fixture real.
 */

import { buscarJson } from '../http/client.js';
import type { ConfigDeclarativa, Extracao } from './esquema.js';
import type { AdaptadorCasa, EventoDaCasa } from './tipos.js';

/** Navega `a.b.c` num objeto desconhecido, sem lancar. */
export function pegar(obj: unknown, caminho: string): unknown {
  let atual: unknown = obj;
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function texto(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
}

const diaUtc = (base: Date, deslocamento: number): Date =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + deslocamento));

/**
 * Substitui os marcadores do template.
 *
 * Datas em UTC: a Superbet devolveu `utcDate: 2026-08-13T00:00:00Z` para
 * `startDate=2026-08-13 00:00:00`, ou seja interpreta o parametro como UTC.
 */
export function montarUrl(
  template: string,
  opcoes: { dia: number; competitionId?: string; agora?: Date },
): string {
  const base = opcoes.agora ?? new Date();
  const inicio = diaUtc(base, opcoes.dia);
  const fim = diaUtc(base, opcoes.dia + 1);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  return template
    .replaceAll('{data}', ymd(inicio))
    .replaceAll('{dataFim}', ymd(fim))
    .replaceAll('{unixInicio}', String(Math.floor(inicio.getTime() / 1000)))
    .replaceAll('{unixFim}', String(Math.floor(fim.getTime() / 1000)))
    .replaceAll('{competitionId}', opcoes.competitionId ?? '');
}

function lerKickoff(evento: unknown, extracao: Extracao): number | null {
  const bruto = pegar(evento, extracao.kickoff.campo);
  if (extracao.kickoff.unidade === 'iso') {
    const t = Date.parse(String(bruto));
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return null;
  return extracao.kickoff.unidade === 'ms' ? Math.floor(n / 1000) : Math.floor(n);
}

function lerTimes(evento: unknown, extracao: Extracao): { mandante: string; visitante: string } | null {
  const t = extracao.times;
  if ('mandante' in t) {
    const mandante = texto(pegar(evento, t.mandante))?.trim();
    const visitante = texto(pegar(evento, t.visitante))?.trim();
    return mandante && visitante ? { mandante, visitante } : null;
  }

  const inteiro = texto(pegar(evento, t.campo));
  if (!inteiro) return null;
  const partes = inteiro.split(t.separador);
  // Exatamente 2, sem tolerancia: um nome de time que contenha o separador
  // partiria errado e viraria pareamento errado. Melhor perder o jogo.
  if (partes.length !== 2) return null;
  const mandante = partes[0]!.trim();
  const visitante = partes[1]!.trim();
  return mandante && visitante ? { mandante, visitante } : null;
}

function casaComFiltro(item: unknown, filtro: Record<string, string | number>): boolean {
  return Object.entries(filtro).every((par) => {
    const [campo, esperado] = par;
    return String(pegar(item, campo)) === String(esperado);
  });
}

function lerMercado(evento: unknown, extracao: Extracao): Pick<EventoDaCasa, 'casa' | 'empate' | 'fora'> | null {
  const m = extracao.mercado;
  const lista = pegar(evento, m.lista);
  if (!Array.isArray(lista)) return null;

  const candidatas = lista.filter((item) => casaComFiltro(item, m.filtro));

  const preco = (alvo: string): number | null => {
    const item = candidatas.find((c) => String(pegar(c, m.chave)) === alvo);
    if (item === undefined) return null;
    // Odd suspensa nao e apostavel. Sem isto o robo montaria arbitragem sobre
    // uma perna morta — o mesmo cuidado que `active` recebe no lado Flashscore.
    if (m.ativo && String(pegar(item, m.ativo.campo)) !== m.ativo.valor) return null;
    const v = Number(pegar(item, m.preco));
    return Number.isFinite(v) && v > 1 ? v : null;
  };

  const casa = preco(m.casa);
  const empate = preco(m.empate);
  const fora = preco(m.fora);
  if (casa === null || empate === null || fora === null) return null;
  return { casa, empate, fora };
}

/**
 * Converte a resposta crua da casa em eventos utilizaveis.
 *
 * Evento incompleto e DESCARTADO em silencio, nunca remendado: um jogo perdido
 * custa uma oportunidade, um jogo com dado errado custa dinheiro.
 */
export function extrairEventos(resposta: unknown, extracao: Extracao): EventoDaCasa[] {
  const lista = pegar(resposta, extracao.eventos);
  if (!Array.isArray(lista)) return [];

  const eventos: EventoDaCasa[] = [];
  for (const bruto of lista) {
    const idNaCasa = texto(pegar(bruto, extracao.idNaCasa));
    if (!idNaCasa) continue;

    const times = lerTimes(bruto, extracao);
    if (!times) continue;

    const kickoffUnix = lerKickoff(bruto, extracao);
    if (kickoffUnix === null) continue;

    const mercado = lerMercado(bruto, extracao);
    if (!mercado) continue;

    eventos.push({
      idNaCasa,
      ...times,
      kickoffUnix,
      competicaoNaCasa: extracao.competicao
        ? (texto(pegar(bruto, extracao.competicao)) ?? undefined)
        : undefined,
      betradarId: extracao.betradarId
        ? (texto(pegar(bruto, extracao.betradarId)) ?? undefined)
        : undefined,
      ...mercado,
    });
  }
  return eventos;
}

/** Amarra a config a rede. As competicoes so importam para `busca: por-competicao`. */
export function criarAdaptador(
  config: ConfigDeclarativa,
  competicoesDaCasa: () => Promise<string[]> = async () => [],
): AdaptadorCasa {
  return {
    bookmakerId: config.bookmakerId,
    nome: config.nome,
    async listarDoDia(dia: number): Promise<EventoDaCasa[]> {
      const opcoes = { headers: config.requisicao.headers };

      if (config.busca !== 'por-competicao') {
        const url = montarUrl(config.requisicao.url, { dia });
        return extrairEventos(await buscarJson<unknown>(url, opcoes), config.extracao);
      }

      // Casa que so responde por liga: uma requisicao por competicao habilitada.
      // Caminho caro de proposito — o motor so o usa quando a casa nao oferece
      // busca por data. Ver `docs/casas-sondagem.md` para quem cai aqui.
      const competicoes = await competicoesDaCasa();
      const eventos: EventoDaCasa[] = [];
      for (const competitionId of competicoes) {
        const url = montarUrl(config.requisicao.url, { dia, competitionId });
        eventos.push(...extrairEventos(await buscarJson<unknown>(url, opcoes), config.extracao));
      }
      return eventos;
    },
  };
}
