/**
 * Compara as duas fontes de odds, casa a casa.
 *
 * E o instrumento que responde a pergunta que originou o projeto — "quanto o
 * Flashscore erra?" — com medicao continua em vez de suspeita. Sem ele o modo
 * `ambos` so gastaria banda dobrada.
 *
 * Puro, sem I/O: quem grava e o `index.ts`.
 *
 * Serve tambem de detector de bug de adaptador. Atraso de agregador aparece
 * como divergencia pequena e espalhada por todas as casas; adaptador errado
 * aparece como uma casa fora do padrao de todas as outras, ou como uma perna
 * (so o empate, por exemplo) sempre errada. As duas assinaturas sao distinguiveis
 * na tabela — e a segunda e a que custa dinheiro.
 */

import type { OddsCasa } from '../arb/calc.js';

export interface Divergencia {
  matchId: string;
  bookmakerId: number;
  nome: string;
  fs: { casa: number; empate: number; fora: number };
  dir: { casa: number; empate: number; fora: number };
  /** Maior diferenca relativa entre as tres pernas. */
  desvioMaxPct: number;
}

/**
 * Odds sao decimais com 2-3 casas; comparar por igualdade exata registraria
 * ruido de arredondamento como divergencia e afogaria o sinal.
 */
const EPSILON = 0.005;

function desvioRelativo(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return Math.abs(a - b) / b;
}

/**
 * Devolve so as casas presentes NAS DUAS fontes e que de fato divergem.
 *
 * Casa que existe so de um lado nao e divergencia, e diferenca de cobertura —
 * misturar as duas coisas tornaria a tabela ilegivel.
 */
export function compararFontes(
  matchId: string,
  doFlashscore: OddsCasa[],
  doDireto: OddsCasa[],
): Divergencia[] {
  const porId = new Map(doFlashscore.map((c) => [c.bookmakerId, c]));

  const saida: Divergencia[] = [];
  for (const d of doDireto) {
    const f = porId.get(d.bookmakerId);
    if (!f) continue;

    const pernas: Array<[number, number]> = [
      [d.casa, f.casa],
      [d.empate, f.empate],
      [d.fora, f.fora],
    ];
    if (pernas.every(([x, y]) => Math.abs(x - y) <= EPSILON)) continue;

    saida.push({
      matchId,
      bookmakerId: d.bookmakerId,
      nome: d.nome,
      fs: { casa: f.casa, empate: f.empate, fora: f.fora },
      dir: { casa: d.casa, empate: d.empate, fora: d.fora },
      desvioMaxPct: Math.max(...pernas.map(([x, y]) => desvioRelativo(x, y))) * 100,
    });
  }
  return saida;
}

/** Percorre todos os jogos cobertos pelas duas fontes. */
export function compararTudo(
  doFlashscore: Map<string, OddsCasa[]>,
  doDireto: Map<string, OddsCasa[]>,
): Divergencia[] {
  const saida: Divergencia[] = [];
  for (const [matchId, diretas] of doDireto) {
    const fs = doFlashscore.get(matchId);
    if (!fs) continue;
    saida.push(...compararFontes(matchId, fs, diretas));
  }
  return saida;
}
