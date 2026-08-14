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

// ------------------------------------------------------- sentinela de inversao

/**
 * Tolerancia do teste de espelho, RELATIVA e bem mais larga que o EPSILON.
 *
 * O Flashscore trunca a odd em 2 casas sempre para baixo (1,8182 -> 1,81), e a
 * inversao precisa ser detectada apesar disso. 2% engole o truncamento sem
 * chegar perto de fazer odds de jogos diferentes parecerem espelhadas.
 */
const TOLERANCIA_ESPELHO = 0.02;

/** Amostra minima para o veredito valer. Abaixo disso, coincidencia e barata. */
const MINIMO_COMPARACOES = 20;

/**
 * Fracao de pernas espelhadas que caracteriza inversao.
 *
 * Nao e um numero delicado: a inversao e SISTEMATICA (todas as casas viram
 * juntas, porque o erro esta no parser, nao no preco). Medido em 14/08/2026:
 * 99,6% invertido, 0% depois da correcao. Meio caminho entre os dois extremos
 * e seguro por larga margem nas duas direcoes.
 */
const LIMIAR_ESPELHADAS = 0.5;

export interface VereditoInversao {
  comparadas: number;
  espelhadas: number;
  fracaoEspelhada: number;
  /** True quando ha amostra suficiente E a maioria das pernas esta espelhada. */
  invertido: boolean;
  exemplos: Divergencia[];
}

const perto = (a: number, b: number): boolean => desvioRelativo(a, b) <= TOLERANCIA_ESPELHO;

/**
 * Detecta mandante/visitante trocados entre as duas fontes.
 *
 * Existe porque fixture NAO pega isto. A ordem dos participantes no payload do
 * Flashscore ja virou duas vezes (12/08 e 14/08/2026) e nao ha `homeAway` nem
 * `side` para conferir — entao a unica prova e uma segunda fonte com rotulo
 * explicito, que e o que as casas diretas tem (`VenueRole` na CT, dupla fonte
 * no Altenar). Em 14/08 a inversao viveu dois dias com os 163 testes verdes.
 *
 * A assinatura e inconfundivel: o EMPATE bate exatamente e so casa/fora trocam.
 * Diferenca de preco de verdade nao respeita essa simetria.
 *
 * Jogo com odds iguais nas tres pernas conta como igual, nunca como espelhado —
 * senao partida equilibrada (2,50 / 3,20 / 2,50) viraria falso positivo, e
 * alarme que grita a toa e alarme que sera ignorado quando gritar de verdade.
 */
export function analisarInversao(
  doFlashscore: Map<string, OddsCasa[]>,
  doDireto: Map<string, OddsCasa[]>,
): VereditoInversao {
  let comparadas = 0;
  let espelhadas = 0;
  const exemplos: Divergencia[] = [];

  for (const [matchId, diretas] of doDireto) {
    const fs = doFlashscore.get(matchId);
    if (!fs) continue;
    const porId = new Map(fs.map((c) => [c.bookmakerId, c]));

    for (const d of diretas) {
      const f = porId.get(d.bookmakerId);
      if (!f) continue;
      comparadas++;

      const igual = perto(f.casa, d.casa) && perto(f.empate, d.empate) && perto(f.fora, d.fora);
      if (igual) continue;

      const espelhado = perto(f.empate, d.empate) && perto(f.casa, d.fora) && perto(f.fora, d.casa);
      if (!espelhado) continue;

      espelhadas++;
      if (exemplos.length < 3) {
        exemplos.push({
          matchId,
          bookmakerId: d.bookmakerId,
          nome: d.nome,
          fs: { casa: f.casa, empate: f.empate, fora: f.fora },
          dir: { casa: d.casa, empate: d.empate, fora: d.fora },
          desvioMaxPct: Math.max(desvioRelativo(f.casa, d.casa), desvioRelativo(f.fora, d.fora)) * 100,
        });
      }
    }
  }

  const fracaoEspelhada = comparadas === 0 ? 0 : espelhadas / comparadas;
  return {
    comparadas,
    espelhadas,
    fracaoEspelhada,
    invertido: comparadas >= MINIMO_COMPARACOES && fracaoEspelhada >= LIMIAR_ESPELHADAS,
    exemplos,
  };
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
