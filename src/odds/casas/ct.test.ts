import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extrairJogosCt, extrairOddsCt, juntarCt } from './ct.js';
import type { CtMercado, CtRespostaEventos } from './ct.js';
import { validarConfig } from '../esquema.js';

/**
 * Capturas reais da Bet7k em 14/08/2026 (25 jogos e os 25 mercados ML0
 * correspondentes). Fixture real e nao mock: e o que avisa quando a CT mudar
 * de formato — sobretudo se `Side` ou o sufixo do `_id` deixarem de concordar.
 */
const eventos: CtRespostaEventos = JSON.parse(readFileSync('fixtures/ct-events.json', 'utf8'));
const mercados: Record<string, CtMercado> = JSON.parse(
  readFileSync('fixtures/ct-markets.json', 'utf8'),
);

const ID_CONHECIDO = '875537292310450176';

describe('extrairJogosCt contra a captura real', () => {
  const jogos = extrairJogosCt(eventos);

  it('extrai a listagem inteira', () => {
    expect(jogos).toHaveLength(25);
  });

  it('usa VenueRole para o rotulo, nao a ordem de aparicao', () => {
    const j = jogos.find((x) => x.idNaCasa === ID_CONHECIDO)!;
    expect(j.mandante).toBe('AD Carmelita');
    expect(j.visitante).toBe('Consultants Moravia');
    expect(j.competicaoNaCasa).toBe('870749189062287360');
    expect(new Date(j.kickoffUnix * 1000).toISOString()).toBe('2026-08-14T21:00:00.000Z');
  });

  it('descarta jogo sem os dois papeis definidos', () => {
    const so = { data: [structuredClone(eventos.data![0]!)] };
    so.data[0]!.Participants = [{ Name: 'Time A', VenueRole: 'Home' }];
    expect(extrairJogosCt(so)).toHaveLength(0);
  });

  it('descarta jogo ao vivo', () => {
    const so = { data: [structuredClone(eventos.data![0]!)] };
    so.data[0]!.IsLive = true;
    expect(extrairJogosCt(so)).toHaveLength(0);
  });

  it('nao explode com resposta vazia ou torta', () => {
    expect(extrairJogosCt({})).toEqual([]);
    expect(extrairJogosCt({ data: [] })).toEqual([]);
  });
});

describe('extrairOddsCt contra a captura real', () => {
  const odds = extrairOddsCt(mercados);

  it('le o objeto indexado por chave numerica, nao um array', () => {
    // A resposta de odds vem como {"0":{…},"1":{…}} — tratar como array
    // devolveria vazio em silencio, que e o modo de falha caro aqui.
    expect(odds.size).toBe(25);
  });

  it('mapeia Side para casa/empate/fora', () => {
    const p = odds.get(ID_CONHECIDO)!;
    expect(p.casa).toBe(2.53);
    expect(p.empate).toBe(3.22);
    expect(p.fora).toBe(2.47);
  });

  it('juice em faixa plausivel em todos os jogos', () => {
    for (const p of odds.values()) {
      const s = 1 / p.casa + 1 / p.empate + 1 / p.fora;
      expect(s).toBeGreaterThan(1);
      expect(s).toBeLessThan(1.35);
    }
  });
});

describe('extrairOddsCt — descarte seguro', () => {
  /** Um mercado so, clonado, para mexer sem contaminar o resto. */
  function umMercado(): Record<string, CtMercado> {
    const m = Object.values(mercados).find((x) => x.EventId === ID_CONHECIDO)!;
    return { 0: structuredClone(m) };
  }

  it('descarta quando Side e o sufixo do _id discordam', () => {
    // Sao as duas fontes independentes do rotulo. Rotulo trocado NAO muda S,
    // entao nenhum teste de numero agregado pegaria isso — e apostar no time
    // errado pelo preco do outro mata a arbitragem na execucao.
    const f = umMercado();
    const casa = f[0]!.Selections!.find((s) => s.Side === 1)!;
    casa._id = casa._id!.slice(0, -1) + 'A';
    expect(extrairOddsCt(f).size).toBe(0);
  });

  it('descarta o mercado quando uma perna esta desabilitada', () => {
    const f = umMercado();
    f[0]!.Selections![0]!.IsDisabled = true;
    expect(extrairOddsCt(f).size).toBe(0);
  });

  it('descarta mercado suspenso', () => {
    const f = umMercado();
    f[0]!.IsSuspended = true;
    expect(extrairOddsCt(f).size).toBe(0);
  });

  it('ignora mercado que nao seja o 1X2 pre-jogo', () => {
    // ML39/ML169 sao o 1X2 AO VIVO. Aceita-los traria odds de jogo rolando.
    const f = umMercado();
    f[0]!.MarketType = { _id: 'ML39' };
    expect(extrairOddsCt(f).size).toBe(0);
  });

  it('descarta odd nao numerica', () => {
    const f = umMercado();
    f[0]!.Selections![0]!.DisplayOdds = { Decimal: 'n/a' };
    expect(extrairOddsCt(f).size).toBe(0);
  });

  it('nao explode com resposta vazia ou torta', () => {
    expect(extrairOddsCt({}).size).toBe(0);
    expect(extrairOddsCt([]).size).toBe(0);
  });
});

describe('juntarCt', () => {
  const jogos = extrairJogosCt(eventos);
  const odds = extrairOddsCt(mercados);

  it('junta os dois endpoints em EventoDaCasa', () => {
    const e = juntarCt(jogos, odds);
    expect(e).toHaveLength(25);
    const j = e.find((x) => x.idNaCasa === ID_CONHECIDO)!;
    expect(j.mandante).toBe('AD Carmelita');
    expect(j.casa).toBe(2.53);
  });

  it('descarta quando o nome do mandante discorda entre os dois endpoints', () => {
    // Odds do jogo errado coladas no jogo certo seria falha silenciosa: os
    // numeros continuam plausiveis e so o alerta sai errado.
    const trocado = new Map(odds);
    trocado.set(ID_CONHECIDO, { ...odds.get(ID_CONHECIDO)!, nomeCasa: 'Outro Time' });
    expect(juntarCt(jogos, trocado)).toHaveLength(24);
  });

  it('descarta jogo sem odds', () => {
    expect(juntarCt(jogos, new Map())).toHaveLength(0);
  });
});

describe('config da plataforma ct', () => {
  it('valida a semente da Bet7k e aplica o bootstrap padrao', () => {
    const r = validarConfig({
      bookmakerId: 1069,
      nome: 'Bet7k',
      plataforma: 'ct',
      host: 'https://prod20350-kbet-152319626.fssb.io',
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.config.plataforma === 'ct') {
      expect(r.config.bootstrap).toBe('/br-pt/spbkv4?operatorToken=logout');
    }
  });

  it('recusa host que nao seja URL', () => {
    const r = validarConfig({ bookmakerId: 1069, nome: 'Bet7k', plataforma: 'ct', host: 'nao-e-url' });
    expect(r.ok).toBe(false);
  });
});
