import { describe, expect, it } from 'vitest';
import { analisarInversao, compararFontes, compararTudo } from './divergencia.js';
import type { OddsCasa } from '../arb/calc.js';

const casa = (p: Partial<OddsCasa> & { bookmakerId: number }): OddsCasa => ({
  nome: `casa${p.bookmakerId}`,
  casa: 2,
  empate: 3.4,
  fora: 3.6,
  ...p,
});

describe('compararFontes', () => {
  it('nao registra nada quando as duas fontes concordam', () => {
    const iguais = [casa({ bookmakerId: 933 })];
    expect(compararFontes('m1', iguais, iguais)).toEqual([]);
  });

  it('ignora ruido de arredondamento', () => {
    // Odd e decimal de 2-3 casas; sem epsilon a tabela viraria ruido puro.
    const fs = [casa({ bookmakerId: 933, casa: 2.0 })];
    const dir = [casa({ bookmakerId: 933, casa: 2.004 })];
    expect(compararFontes('m1', fs, dir)).toEqual([]);
  });

  it('registra divergencia real com o desvio maximo entre as pernas', () => {
    const fs = [casa({ bookmakerId: 933, casa: 2.0, empate: 3.4, fora: 3.6 })];
    const dir = [casa({ bookmakerId: 933, casa: 2.2, empate: 3.4, fora: 3.6 })];
    const r = compararFontes('m1', fs, dir);
    expect(r).toHaveLength(1);
    expect(r[0]!.desvioMaxPct).toBeCloseTo(10, 5); // 0,2 sobre 2,0
    expect(r[0]!.fs.casa).toBe(2.0);
    expect(r[0]!.dir.casa).toBe(2.2);
  });

  it('ignora casa presente em so uma das fontes', () => {
    // Cobertura diferente nao e divergencia; misturar tornaria a tabela ilegivel.
    const fs = [casa({ bookmakerId: 16 })];
    const dir = [casa({ bookmakerId: 933, casa: 9 })];
    expect(compararFontes('m1', fs, dir)).toEqual([]);
  });

  it('pega inversao mandante/visitante como desvio grande — o caso que importa', () => {
    // Assinatura do bug ja vivido: empate identico, casa e fora trocados.
    const fs = [casa({ bookmakerId: 933, casa: 11, empate: 6.7, fora: 1.19 })];
    const dir = [casa({ bookmakerId: 933, casa: 1.19, empate: 6.7, fora: 11 })];
    const r = compararFontes('m1', fs, dir);
    expect(r).toHaveLength(1);
    expect(r[0]!.desvioMaxPct).toBeGreaterThan(80);
  });
});

describe('compararTudo', () => {
  it('percorre so os jogos cobertos pelas duas fontes', () => {
    const fs = new Map([['m1', [casa({ bookmakerId: 933, casa: 2 })]]]);
    const dir = new Map([
      ['m1', [casa({ bookmakerId: 933, casa: 2.5 })]],
      ['m2', [casa({ bookmakerId: 933, casa: 9 })]], // so no direto
    ]);
    const r = compararTudo(fs, dir);
    expect(r).toHaveLength(1);
    expect(r[0]!.matchId).toBe('m1');
  });

  it('devolve vazio quando nao ha sobreposicao', () => {
    expect(compararTudo(new Map(), new Map([['m1', [casa({ bookmakerId: 1 })]]]))).toEqual([]);
  });
});

/**
 * Sentinela de inversao.
 *
 * O que estes testes protegem nao e um calculo — e a unica coisa capaz de
 * perceber a ordem dos participantes do Flashscore virar. Fixture nao pega, e
 * em 14/08/2026 a inversao viveu dois dias com a suite inteira verde.
 */
describe('analisarInversao', () => {
  /** N jogos com M casas, todas concordando. */
  function fonteNormal(jogos = 10, casas = 5) {
    const mapa = new Map<string, OddsCasa[]>();
    for (let j = 0; j < jogos; j++) {
      mapa.set(
        `m${j}`,
        Array.from({ length: casas }, (_, b) =>
          casa({ bookmakerId: 900 + b, casa: 1.8 + j * 0.1, empate: 3.5, fora: 4.2 - j * 0.05 }),
        ),
      );
    }
    return mapa;
  }

  const espelhar = (m: Map<string, OddsCasa[]>) =>
    new Map(
      [...m].map(([id, cs]) => [id, cs.map((c) => ({ ...c, casa: c.fora, fora: c.casa }))]),
    );

  it('nao acusa quando as fontes concordam', () => {
    const fs = fonteNormal();
    const v = analisarInversao(fs, fonteNormal());
    expect(v.comparadas).toBe(50);
    expect(v.espelhadas).toBe(0);
    expect(v.invertido).toBe(false);
  });

  it('acusa quando casa/fora estao trocados com o empate identico', () => {
    const fs = fonteNormal();
    const v = analisarInversao(fs, espelhar(fs));
    expect(v.comparadas).toBe(50);
    expect(v.espelhadas).toBe(50);
    expect(v.invertido).toBe(true);
    expect(v.exemplos).toHaveLength(3);
  });

  it('atravessa o truncamento de 2 casas do Flashscore', () => {
    // A inversao precisa ser vista APESAR de o Flashscore truncar sempre para
    // baixo (1,8182 -> 1,81). Epsilon apertado deixaria passar.
    const fs = new Map<string, OddsCasa[]>();
    const dir = new Map<string, OddsCasa[]>();
    for (let j = 0; j < 10; j++) {
      const ids = Array.from({ length: 3 }, (_, b) => 900 + b);
      fs.set(`m${j}`, ids.map((id) => casa({ bookmakerId: id, casa: 4.33, empate: 3.6, fora: 1.66 })));
      dir.set(
        `m${j}`,
        ids.map((id) => casa({ bookmakerId: id, casa: 1.6667, empate: 3.6, fora: 4.3334 })),
      );
    }
    expect(analisarInversao(fs, dir).invertido).toBe(true);
  });

  it('nao confunde partida equilibrada com espelho', () => {
    // 2,50 / 3,20 / 2,50 e simetrica: espelhar nao muda nada. Contar isso como
    // inversao faria o alarme gritar a toa — e alarme que grita a toa e ignorado.
    const equilibrada = new Map<string, OddsCasa[]>();
    for (let j = 0; j < 10; j++) {
      equilibrada.set(
        `m${j}`,
        Array.from({ length: 5 }, (_, b) =>
          casa({ bookmakerId: 900 + b, casa: 2.5, empate: 3.2, fora: 2.5 }),
        ),
      );
    }
    const v = analisarInversao(equilibrada, equilibrada);
    expect(v.espelhadas).toBe(0);
    expect(v.invertido).toBe(false);
  });

  it('nao acusa com diferenca de preco normal', () => {
    const fs = fonteNormal();
    const dir = new Map(
      [...fonteNormal()].map(([id, cs]) => [id, cs.map((c) => ({ ...c, casa: c.casa * 1.05 }))]),
    );
    expect(analisarInversao(fs, dir).invertido).toBe(false);
  });

  it('cala com amostra pequena, mesmo toda espelhada', () => {
    // Coincidencia e barata em amostra curta, e o custo de esperar mais um
    // ciclo e zero perto do custo de um alarme que ninguem acredita.
    const fs = fonteNormal(2, 3); // 6 comparacoes
    const v = analisarInversao(fs, espelhar(fs));
    expect(v.fracaoEspelhada).toBe(1);
    expect(v.invertido).toBe(false);
  });

  it('ignora casa presente em so uma das fontes', () => {
    const fs = new Map([['m1', [casa({ bookmakerId: 1 }), casa({ bookmakerId: 2 })]]]);
    const dir = new Map([['m1', [casa({ bookmakerId: 2 })]]]);
    expect(analisarInversao(fs, dir).comparadas).toBe(1);
  });

  it('nao explode com fontes vazias', () => {
    const v = analisarInversao(new Map(), new Map());
    expect(v).toMatchObject({ comparadas: 0, espelhadas: 0, invertido: false });
  });
});
