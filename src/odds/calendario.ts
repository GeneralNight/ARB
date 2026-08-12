/**
 * Calendario do sistema direto.
 *
 * O Flashscore continua sendo o CALENDARIO — deixou de ser a fonte de odds, que
 * e onde nascia a divergencia. O feed do dia custa ~310 KB para todas as ligas e
 * ja entrega liga, kickoff e times; refazer isso raspando 27 casas seria pagar
 * caro por algo que ja funciona.
 *
 * Repete um pedaco pequeno de `src/arb/scanner.ts` de proposito: os dois
 * sistemas precisam poder quebrar sem levar o outro junto, e o preco combinado
 * dessa independencia foi duplicar o barato, nunca o `calc.ts`.
 */

import type { Settings } from '../config.js';
import * as repo from '../db/repo.js';
import { buscarFeedDoDia, type Jogo } from '../flashscore/feed.js';

export interface Calendario {
  jogos: Jogo[];
  totalNoFeed: number;
  daLigaHabilitada: number;
}

/** Jogos das ligas habilitadas que ainda nao comecaram, na janela configurada. */
export async function jogosDaJanela(settings: Settings, agora = new Date()): Promise<Calendario> {
  const dias = Array.from({ length: settings.janelaDias + 1 }, (_, i) => i);
  const feeds = await Promise.all(dias.map((d) => buscarFeedDoDia(d)));

  // O mesmo jogo aparece em dois feeds na virada do dia (o Flashscore usa o
  // fuso dele), entao deduplica por id.
  const porId = new Map<string, Jogo>();
  for (const feed of feeds) for (const j of feed.jogos) porId.set(j.id, j);
  const jogos = [...porId.values()];

  const habilitadas = await repo.ligasHabilitadas();
  const daLiga = jogos.filter((j) => habilitadas.has(j.ligaId));

  const limite = agora.getTime() + settings.minutosAntesDoInicio * 60_000;
  const preJogo = daLiga.filter((j) => j.kickoff.getTime() > limite);

  return { jogos: preJogo, totalNoFeed: jogos.length, daLigaHabilitada: daLiga.length };
}
