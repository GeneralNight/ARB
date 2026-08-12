import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extrairAltenar } from './altenar.js';

/**
 * Captura real de `integration=esportiva` (12/08/2026, champIds=11318,2947).
 * Fixture real e nao mock: e o que avisa quando o Altenar mudar de formato.
 */
const fixture = JSON.parse(readFileSync('fixtures/altenar-getevents.json', 'utf8'));

describe('extrairAltenar contra a captura real', () => {
  const eventos = extrairAltenar(fixture);

  it('resolve a juncao events -> markets -> odds -> competitors', () => {
    expect(eventos.length).toBeGreaterThan(20);
    expect(eventos.length).toBeLessThanOrEqual(fixture.events.length);
  });

  it('monta um jogo conhecido por inteiro', () => {
    const e = eventos.find((x) => x.idNaCasa === '16268243')!;
    expect(e).toBeDefined();
    expect(e.mandante).toBe('Fluminense');
    expect(e.visitante).toBe('Palmeiras');
    expect(e.competicaoNaCasa).toBe('11318');
    expect(new Date(e.kickoffUnix * 1000).toISOString()).toBe('2026-08-15T19:30:00.000Z');
  });

  it('extrai o id Sportradar de dentro do extId', () => {
    // `fp32_ar:match:597011` -> `597011`
    const e = eventos.find((x) => x.idNaCasa === '16268243')!;
    expect(e.betradarId).toBe('597011');
  });

  it('odds apostaveis e juice em faixa plausivel', () => {
    for (const e of eventos) {
      for (const odd of [e.casa, e.empate, e.fora]) expect(odd).toBeGreaterThan(1);
      const s = 1 / e.casa + 1 / e.empate + 1 / e.fora;
      expect(s).toBeGreaterThan(1);
      expect(s).toBeLessThan(1.35);
    }
  });
});

describe('extrairAltenar — descarte seguro', () => {
  /** Clona a fixture com um unico evento, para mexer sem contaminar o resto. */
  function comUmEvento(): typeof fixture {
    const ev = fixture.events.find((e: { id: number }) => e.id === 16268243);
    return structuredClone({ ...fixture, events: [ev] });
  }

  it('descarta quando as duas fontes de mandante discordam', () => {
    // A ordem de `competitorIds` e o `competitorId` da cotacao tipo 1 sao duas
    // fontes independentes de quem joga em casa. Discordando, nao da para saber
    // qual esta certa — e chutar aqui e o bug que ja custou caro do lado do
    // Flashscore, onde nao havia segunda fonte para conferir.
    const f = comUmEvento();
    const ev = f.events[0];
    const mercado = f.markets.find(
      (m: { id: number; typeId: number }) => m.typeId === 1 && ev.marketIds.includes(m.id),
    );
    const oddCasa = f.odds.find(
      (o: { id: number; typeId: number }) => mercado.oddIds.includes(o.id) && o.typeId === 1,
    );
    oddCasa.competitorId = 999999; // discorda de competitorIds[0]

    expect(extrairAltenar(f)).toHaveLength(0);
  });

  it('descarta a casa inteira quando uma perna esta suspensa', () => {
    const f = comUmEvento();
    const ev = f.events[0];
    const mercado = f.markets.find(
      (m: { id: number; typeId: number }) => m.typeId === 1 && ev.marketIds.includes(m.id),
    );
    f.odds.find((o: { id: number }) => o.id === mercado.oddIds[0]).oddStatus = 1;

    expect(extrairAltenar(f)).toHaveLength(0);
  });

  it('descarta evento sem o mercado 1X2', () => {
    const f = comUmEvento();
    f.markets = f.markets.filter((m: { typeId: number }) => m.typeId !== 1);
    expect(extrairAltenar(f)).toHaveLength(0);
  });

  it('descarta evento cujo competidor nao esta na tabela de nomes', () => {
    const f = comUmEvento();
    f.competitors = [];
    expect(extrairAltenar(f)).toHaveLength(0);
  });

  it('nao explode com resposta vazia ou torta', () => {
    expect(extrairAltenar({})).toEqual([]);
    expect(extrairAltenar({ events: [] })).toEqual([]);
  });
});
