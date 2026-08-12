import { describe, expect, it } from 'vitest';
import { compararFontes, compararTudo } from './divergencia.js';
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
