import { describe, expect, it } from 'vitest';
import { MIN_CASAS_PARA_FILTRAR, bestLine, filtrarOutliers, type OddsCasa } from './calc.js';

const casa = (id: number, c: number, e: number, f: number): OddsCasa => ({
  bookmakerId: id,
  nome: `casa${id}`,
  casa: c,
  empate: e,
  fora: f,
});

/** Mercado normal: dispersao pequena em torno do mesmo preco. */
const MERCADO = [
  casa(1, 3.2, 3.3, 2.3),
  casa(2, 3.25, 3.3, 2.32),
  casa(3, 3.3, 3.35, 2.28),
  casa(4, 3.15, 3.25, 2.35),
  casa(5, 3.28, 3.32, 2.31),
  casa(6, 3.22, 3.28, 2.33),
];

describe('filtrarOutliers — o caso real que motivou o filtro', () => {
  it('remove a odd defasada de Botafogo x Fluminense', () => {
    // 07/08/2026: alerta de "arbitragem" de 25,95% com 5,50 numa perna enquanto
    // o resto do mercado precificava ~3,25. Odd velha, nao preco.
    const comOutlier = [...MERCADO, casa(995, 5.5, 3.3, 2.3)];
    const r = filtrarOutliers(comOutlier, 25);

    expect(r.descartadas).toHaveLength(1);
    expect(r.descartadas[0]!.casa.bookmakerId).toBe(995);
    expect(r.descartadas[0]!.resultado).toBe('casa');
    expect(r.mantidas).toHaveLength(MERCADO.length);
  });

  it('mata a arbitragem falsa que a odd defasada criava', () => {
    const comOutlier = [...MERCADO, casa(995, 5.5, 3.3, 2.3)];

    const semFiltro = bestLine(comOutlier)!;
    expect(semFiltro.margemPct).toBeLessThan(0); // "arbitragem" fantasma

    const comFiltro = bestLine(filtrarOutliers(comOutlier, 25).mantidas)!;
    expect(comFiltro.margemPct).toBeGreaterThan(0); // realidade: sem arbitragem
  });
});

describe('filtrarOutliers — garantias', () => {
  it('NUNCA inventa arbitragem: a margem so pode piorar ou ficar igual', () => {
    // Propriedade central. Remover candidatos so reduz o maximo de cada perna,
    // entao S so pode subir. Errar aqui custa oportunidade, nunca dinheiro.
    const cenarios: OddsCasa[][] = [
      [...MERCADO, casa(9, 9, 3.3, 2.3)],
      [...MERCADO, casa(9, 3.2, 8, 2.3)],
      [...MERCADO, casa(9, 3.2, 3.3, 7)],
      [...MERCADO, casa(9, 4.5, 4.6, 3.4)],
      MERCADO,
    ];

    for (const books of cenarios) {
      const antes = bestLine(books);
      const depois = bestLine(filtrarOutliers(books, 25).mantidas);
      if (!antes || !depois) continue;
      expect(depois.margemPct).toBeGreaterThanOrEqual(antes.margemPct - 1e-9);
    }
  });

  it('nao mexe em odd baixa demais — ela nunca cria arbitragem falsa', () => {
    // Odd abaixo do mercado so aumenta S. Filtra-la reduziria cobertura de graca.
    const comBaixa = [...MERCADO, casa(9, 1.5, 3.3, 2.3)];
    expect(filtrarOutliers(comBaixa, 25).descartadas).toHaveLength(0);
  });

  it('nao filtra com poucas casas — mediana nao distingue outlier de dispersao', () => {
    // O total (mercado + outlier) precisa ficar abaixo do minimo.
    const comOutlier = [...MERCADO.slice(0, MIN_CASAS_PARA_FILTRAR - 2), casa(9, 9, 3.3, 2.3)];
    expect(comOutlier.length).toBeLessThan(MIN_CASAS_PARA_FILTRAR);

    const r = filtrarOutliers(comOutlier, 25);
    expect(r.descartadas).toHaveLength(0);
    expect(r.mantidas).toHaveLength(comOutlier.length);
  });

  it('desligado passa tudo adiante, intacto', () => {
    const comOutlier = [...MERCADO, casa(9, 9, 3.3, 2.3)];
    for (const limiar of [0, -1]) {
      const r = filtrarOutliers(comOutlier, limiar);
      expect(r.mantidas).toEqual(comOutlier);
      expect(r.descartadas).toHaveLength(0);
    }
  });

  it('preserva a vantagem legitima da melhor casa', () => {
    // Uma casa 8% acima da mediana e a melhor odd do mercado, nao defeito —
    // e exatamente o que o robo existe para achar. Filtrar isso o cegaria.
    const comBoa = [...MERCADO, casa(9, 3.5, 3.3, 2.3)];
    const r = filtrarOutliers(comBoa, 25);
    expect(r.descartadas).toHaveLength(0);
    expect(bestLine(r.mantidas)!.casa.bookmakerId).toBe(9);
  });

  it('limiar mais apertado descarta mais', () => {
    const books = [...MERCADO, casa(9, 3.9, 3.3, 2.3)]; // ~20% acima da mediana
    expect(filtrarOutliers(books, 25).descartadas).toHaveLength(0);
    expect(filtrarOutliers(books, 10).descartadas).toHaveLength(1);
  });

  it('descarta a casa inteira quando uma perna e outlier', () => {
    // bestLine ja descarta casa com perna invalida; alem disso, casa com um
    // preco podre nao merece confianca nos outros dois.
    const books = [...MERCADO, casa(9, 3.2, 3.3, 6)];
    const r = filtrarOutliers(books, 25);
    expect(r.mantidas.find((b) => b.bookmakerId === 9)).toBeUndefined();
  });

  it('registra o que descartou, para o diagnostico nao virar caixa-preta', () => {
    const books = [...MERCADO, casa(9, 9, 3.3, 2.3)];
    const d = filtrarOutliers(books, 25).descartadas[0]!;
    expect(d.odd).toBe(9);
    expect(d.mediana).toBeGreaterThan(3);
    expect(d.mediana).toBeLessThan(3.5);
  });
});
