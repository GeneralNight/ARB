/**
 * Nucleo matematico da arbitragem 1X2.
 *
 * Funcoes puras, sem I/O. Tudo que decide quanto apostar mora aqui, porque um
 * erro nesse arquivo custa dinheiro de verdade.
 *
 *   S = 1/odd_casa + 1/odd_empate + 1/odd_fora
 *   S < 1  =>  existe arbitragem
 *   ROI    = 1/S - 1
 *   stake_i = total * (1/odd_i) / S
 */

export type Resultado = 'casa' | 'empate' | 'fora';

export interface OddsCasa {
  bookmakerId: number;
  nome: string;
  casa: number;
  empate: number;
  fora: number;
}

/** Melhor odd de cada resultado, cada uma vinda de uma casa distinta. */
export interface MelhorLinha {
  casa: { bookmakerId: number; nome: string; odd: number };
  empate: { bookmakerId: number; nome: string; odd: number };
  fora: { bookmakerId: number; nome: string; odd: number };
  s: number;
  /** (S - 1) * 100. Negativo = arbitragem. */
  margemPct: number;
  bookCount: number;
}

export interface Perna {
  resultado: Resultado;
  bookmakerId: number;
  nome: string;
  odd: number;
  stake: number;
  retorno: number;
}

export interface Aposta {
  s: number;
  /** ROI ja considerando o arredondamento dos stakes. E este que vale. */
  roiPct: number;
  total: number;
  pernas: Perna[];
  /** Lucro no pior dos tres cenarios. Se <= 0, nao e arbitragem. */
  lucroPiorCaso: number;
  isArb: boolean;
}

const RESULTADOS: Resultado[] = ['casa', 'empate', 'fora'];

/** Soma dos inversos das odds. Abaixo de 1 significa arbitragem. */
export function impliedSum(casa: number, empate: number, fora: number): number {
  return 1 / casa + 1 / empate + 1 / fora;
}

/** Retorno sobre o total apostado, em fracao (0.0215 = +2,15%). */
export function roi(s: number): number {
  return 1 / s - 1;
}

/**
 * Escolhe a melhor odd de cada resultado exigindo tres casas DISTINTAS.
 *
 * Sem essa exigencia a mesma casa poderia ficar com duas pernas — e isso nao e
 * arbitragem, e so uma casa generosa. Como a escolha gulosa por resultado pode
 * colidir, testamos todas as combinacoes de tres casas distintas e ficamos com
 * a de menor S. Com ~24 casas isso e barato e evita perder oportunidade que a
 * abordagem gulosa descartaria.
 */
export function bestLine(books: OddsCasa[]): MelhorLinha | null {
  const validos = books.filter(
    (b) =>
      Number.isFinite(b.casa) && b.casa > 1 &&
      Number.isFinite(b.empate) && b.empate > 1 &&
      Number.isFinite(b.fora) && b.fora > 1,
  );
  if (validos.length < 3) return null;

  // Top-N por resultado: o otimo global esta entre os melhores de cada perna.
  // 6 candidatos por perna cobrem qualquer colisao possivel entre 3 casas.
  const topN = 6;
  const top = (k: Resultado) =>
    [...validos].sort((a, b) => b[k] - a[k]).slice(0, topN);

  const cs = top('casa');
  const es = top('empate');
  const fs = top('fora');

  let melhor: MelhorLinha | null = null;
  for (const c of cs) {
    for (const e of es) {
      if (e.bookmakerId === c.bookmakerId) continue;
      for (const f of fs) {
        if (f.bookmakerId === c.bookmakerId || f.bookmakerId === e.bookmakerId) continue;
        const s = impliedSum(c.casa, e.empate, f.fora);
        if (melhor === null || s < melhor.s) {
          melhor = {
            casa: { bookmakerId: c.bookmakerId, nome: c.nome, odd: c.casa },
            empate: { bookmakerId: e.bookmakerId, nome: e.nome, odd: e.empate },
            fora: { bookmakerId: f.bookmakerId, nome: f.nome, odd: f.fora },
            s,
            margemPct: (s - 1) * 100,
            bookCount: validos.length,
          };
        }
      }
    }
  }
  return melhor;
}

/** Stakes teoricos, sem arredondamento: total * (1/odd_i) / S. */
export function rawStakes(total: number, odds: number[], s: number): number[] {
  return odds.map((o) => (total * (1 / o)) / s);
}

function arredondar(valor: number, incremento: number): number {
  if (incremento <= 0) return valor;
  return Math.round(valor / incremento) * incremento;
}

/**
 * Monta a aposta a partir da melhor linha, ja com stakes arredondados.
 *
 * O arredondamento e o passo perigoso: casas nao aceitam R$ 33,333. Depois de
 * arredondar, o retorno de cada cenario muda e um arb marginal de +0,4% pode
 * virar prejuizo. Por isso o ROI reportado e SEMPRE recalculado a partir dos
 * stakes finais e do pior cenario — nunca o ROI teorico.
 */
export function montarAposta(
  linha: MelhorLinha,
  total: number,
  incrementoStake: number,
): Aposta {
  const escolhas = [linha.casa, linha.empate, linha.fora];
  const odds = escolhas.map((e) => e.odd);
  const brutos = rawStakes(total, odds, linha.s);

  // Arredonda as duas primeiras e da a sobra para a terceira, para o total
  // fechar exatamente na banca pedida em vez de estourar por centavos.
  const stakes = brutos.map((v) => Math.max(incrementoStake, arredondar(v, incrementoStake)));
  const somaParciais = stakes[0]! + stakes[1]!;
  const resto = arredondar(total - somaParciais, incrementoStake);
  if (resto >= incrementoStake) stakes[2] = resto;

  const totalReal = stakes.reduce((a, b) => a + b, 0);

  const pernas: Perna[] = escolhas.map((e, i) => ({
    resultado: RESULTADOS[i]!,
    bookmakerId: e.bookmakerId,
    nome: e.nome,
    odd: e.odd,
    stake: round2(stakes[i]!),
    retorno: round2(stakes[i]! * e.odd),
  }));

  const piorRetorno = Math.min(...pernas.map((p) => p.retorno));
  const lucroPiorCaso = round2(piorRetorno - totalReal);
  const roiPct = totalReal > 0 ? (lucroPiorCaso / totalReal) * 100 : 0;

  return {
    s: linha.s,
    roiPct,
    total: round2(totalReal),
    pernas,
    lucroPiorCaso,
    isArb: lucroPiorCaso > 0,
  };
}

/**
 * Decide se o alerta deve disparar.
 *
 * O corte usa o ROI pos-arredondamento, nao o teorico: alertar +0,5% que na
 * pratica vira +0,1% e pior do que nao alertar. O limiar aceita valor negativo
 * de proposito — serve para o modo calibracao, em que voce quer ver os
 * quase-arbs para saber que o robo esta vivo.
 */
export function deveAlertar(aposta: Aposta, lucroMinimoPct: number): boolean {
  if (lucroMinimoPct >= 0 && !aposta.isArb) return false;
  return aposta.roiPct >= lucroMinimoPct;
}

/** Chave estavel de deduplicacao: mesmo jogo + mesmo trio de casas. */
export function dedupeKey(matchId: string, pernas: Perna[]): string {
  const trio = pernas.map((p) => `${p.resultado}:${p.bookmakerId}`).join('|');
  return `${matchId}#${trio}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
