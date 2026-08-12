/**
 * Varredura: jogos de HOJE das ligas habilitadas -> odds -> arbitragem.
 *
 * Cada jogo custa ~900 KB de download (98% do payload e mercado que nao
 * usamos, e nao da para filtrar no servidor). Por isso a cadencia e escalonada
 * pelo tempo ate o apito, em vez de varrer tudo na mesma frequencia.
 */

import { REDE, type Settings } from '../config.js';
import { comLimite, estaBloqueado, segundosAteDesbloquear } from '../flashscore/client.js';
import { apenasPreJogo, buscarFeedDoDia, type Jogo } from '../flashscore/feed.js';
import { buscarOdds } from '../flashscore/odds.js';
import * as repo from '../db/repo.js';
import { bestLine, dedupeKey, deveAlertar, filtrarOutliers, montarAposta, type Aposta, type MelhorLinha, type OddsCasa } from './calc.js';

export interface Oportunidade {
  jogo: Jogo;
  linha: MelhorLinha;
  aposta: Aposta;
  chave: string;
  snapshot: OddsCasa[];
}

export interface ResultadoVarredura {
  jogosNoFeed: number;
  aposFiltroDeLiga: number;
  aposFiltroPreJogo: number;
  aposCadencia: number;
  comOdds: number;
  oportunidades: Oportunidade[];
  linhas: Array<{ jogo: Jogo; linha: MelhorLinha }>;
  /**
   * Odds por casa, por jogo — so para o modo `ambos` comparar as duas fontes.
   *
   * Campo de saida a mais, sem efeito nenhum sobre a varredura. Existe porque
   * estes bytes JA foram baixados aqui (~900 KB por jogo): recalcula-los do
   * lado do sistema direto dobraria a banda do ciclo so para comparar.
   */
  oddsPorJogo: Map<string, OddsCasa[]>;
  erros: number;
  /** Vencidos que ficaram para o proximo ciclo por causa do teto. */
  adiados: number;
  /** True se o disjuntor de rate limit esta segurando as requisicoes. */
  bloqueado: boolean;
  /**
   * Casas descartadas por odd fora de mercado, somadas no ciclo.
   *
   * Visivel de proposito: filtro silencioso e o jeito de o robo emudecer sem
   * ninguem entender por que.
   */
  descartadosPorOutlier: number;
}

/**
 * De quanto em quanto tempo revarrer, conforme a proximidade do apito.
 *
 * Odds pre-jogo se mexem devagar quando o jogo esta longe — um jogo daqui a 40
 * horas nao muda nada em meia hora. Sem a faixa de 24h+, ampliar a janela para
 * varios dias multiplicaria a banda gasta sem ganhar oportunidade nenhuma.
 */
export function intervaloMinutos(minutosAteOInicio: number): number {
  if (minutosAteOInicio > 24 * 60) return 120;
  if (minutosAteOInicio > 6 * 60) return 30;
  if (minutosAteOInicio > 2 * 60) return 10;
  return 2;
}

function devidoAVarrer(
  jogo: Jogo,
  ultima: { em: Date; n: number } | undefined,
  agora: Date,
): boolean {
  if (!ultima) return true;
  const minutosAteOInicio = (jogo.kickoff.getTime() - agora.getTime()) / 60_000;
  const desdeUltima = (agora.getTime() - ultima.em.getTime()) / 60_000;
  return desdeUltima >= intervaloMinutos(minutosAteOInicio);
}

export interface OpcoesVarredura {
  settings: Settings;
  /** Ignora a cadencia e varre tudo que passar nos filtros (usado no scan:once). */
  forcar?: boolean;
  agora?: Date;
}

export async function varrer(opcoes: OpcoesVarredura): Promise<ResultadoVarredura> {
  const { settings, forcar = false } = opcoes;
  const agora = opcoes.agora ?? new Date();

  // janelaDias = 0 varre so hoje; 1 inclui amanha, e assim por diante.
  const dias = Array.from({ length: settings.janelaDias + 1 }, (_, i) => i);
  const feeds = await Promise.all(dias.map((d) => buscarFeedDoDia(d)));

  // O mesmo jogo pode aparecer em dois feeds na virada do dia (o Flashscore
  // usa o fuso dele), entao deduplica por id.
  const porId = new Map<string, Jogo>();
  const ligas = new Map<string, (typeof feeds)[number]['ligas'][number]>();
  for (const feed of feeds) {
    for (const j of feed.jogos) porId.set(j.id, j);
    for (const l of feed.ligas) ligas.set(l.id, l);
  }
  const jogos = [...porId.values()];

  // O catalogo tambem e alimentado aqui: ligas novas aparecem desligadas e
  // ficam disponiveis para voce habilitar no painel.
  await repo.upsertCompeticoes([...ligas.values()]);

  const habilitadas = await repo.ligasHabilitadas();
  const daLiga = jogos.filter((j) => habilitadas.has(j.ligaId));
  const preJogo = apenasPreJogo(daLiga, settings.minutosAntesDoInicio, agora);

  await repo.upsertJogos(preJogo);

  const ultimas = await repo.ultimasVarreduras();
  const vencidos = forcar
    ? preJogo
    : preJogo.filter((j) => devidoAVarrer(j, ultimas.get(j.id), agora));

  // Teto por ciclo: evita rajada contra uma API nao oficial. Quem esta mais
  // perto do apito passa na frente — e onde a odd se mexe e onde o alerta
  // ainda da tempo de ser usado.
  const aVarrer = [...vencidos]
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime())
    .slice(0, REDE.maxPorCiclo);

  const contas = settings.somenteCasasComConta ? await repo.casasComConta() : null;

  const resultados = await comLimite(
    aVarrer.map((jogo) => async () => ({ jogo, odds: await buscarOdds(jogo.id) })),
    REDE.concorrencia,
    REDE.pausaMs,
  );

  const oportunidades: Oportunidade[] = [];
  const linhas: Array<{ jogo: Jogo; linha: MelhorLinha }> = [];
  // As mesmas casas aparecem em todos os jogos: junta tudo e grava uma vez so
  // no fim, em vez de um upsert de 24 linhas por jogo varrido.
  const casasVistas = new Map<number, string>();
  const oddsPorJogo = new Map<string, OddsCasa[]>();
  let comOdds = 0;
  let erros = 0;
  let descartadosPorOutlier = 0;

  for (const r of resultados) {
    if (!r) {
      erros++;
      continue;
    }
    const { jogo, odds } = r;
    if (!odds || odds.casas.length === 0) continue;

    for (const c of odds.casas) casasVistas.set(c.bookmakerId, c.nome);
    oddsPorJogo.set(jogo.id, odds.casas);

    const comConta = contas ? odds.casas.filter((c) => contas.has(c.bookmakerId)) : odds.casas;

    // Odd defasada do agregador ja virou alerta de "arbitragem" de 25,95%.
    // Filtrar so o lado alto: nunca inventa arbitragem, so suprime.
    const filtro = filtrarOutliers(comConta, settings.filtroOutlierPct);
    descartadosPorOutlier += filtro.descartadas.length;

    const linha = bestLine(filtro.mantidas);
    if (!linha) continue;

    comOdds++;
    linhas.push({ jogo, linha });

    await repo.gravarLineScan(jogo.id, linha);
    await repo.marcarVarredura(jogo.id, (ultimas.get(jogo.id)?.n ?? 0) + 1);

    const aposta = montarAposta(linha, settings.banca, settings.incrementoStake);
    if (deveAlertar(aposta, settings.lucroMinimoPct)) {
      oportunidades.push({
        jogo,
        linha,
        aposta,
        chave: dedupeKey(jogo.id, aposta.pernas),
        snapshot: odds.snapshot,
      });
    }
  }

  // O catalogo de casas se alimenta sozinho, para voce marcar has_account.
  await repo.upsertCasas([...casasVistas].map(([id, nome]) => ({ id, nome })));

  // Do maior lucro para o menor: se houver varios, o topo e o que importa.
  oportunidades.sort((a, b) => b.aposta.roiPct - a.aposta.roiPct);

  return {
    jogosNoFeed: jogos.length,
    aposFiltroDeLiga: daLiga.length,
    aposFiltroPreJogo: preJogo.length,
    aposCadencia: aVarrer.length,
    comOdds,
    oportunidades,
    linhas,
    oddsPorJogo,
    erros,
    adiados: vencidos.length - aVarrer.length,
    bloqueado: estaBloqueado(),
    descartadosPorOutlier,
  };
}
