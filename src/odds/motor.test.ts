import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validarConfig, type ConfigCasa } from './esquema.js';
import { extrairEventos, montarUrl, pegar } from './motor.js';

/**
 * Roda contra captura real da Superbet (`fixtures/superbet-by-date.json`,
 * 13/08/2026, 86 eventos). Fixture real e nao mock: e o que detecta o dia em
 * que a casa mudar o formato — mock sintetico so testa a nossa propria opiniao.
 */

const bruto = JSON.parse(readFileSync('src/odds/casas/superbet.json', 'utf8'));
const validacao = validarConfig(bruto);
if (!validacao.ok) throw new Error(`config da Superbet invalida: ${validacao.erro}`);
const config: ConfigCasa = validacao.config;

const fixture = JSON.parse(readFileSync('fixtures/superbet-by-date.json', 'utf8'));

describe('config da Superbet', () => {
  it('passa pelo esquema', () => {
    expect(validacao.ok).toBe(true);
    expect(config.bookmakerId).toBe(933); // id do Flashscore, PK de `bookmakers`
  });
});

describe('extrairEventos contra a captura real', () => {
  const eventos = extrairEventos(fixture, config.extracao);

  it('extrai a maioria dos eventos do arquivo', () => {
    // 84 dos 86 tinham as tres pernas do mercado 547 na captura.
    expect(eventos.length).toBeGreaterThanOrEqual(80);
    expect(eventos.length).toBeLessThanOrEqual(fixture.data.length);
  });

  it('parte o matchName nos dois times', () => {
    const e = eventos.find((x) => x.idNaCasa === '13933710');
    expect(e).toBeDefined();
    expect(e!.mandante).toBe('Monterrey');
    expect(e!.visitante).toBe('Nashville');
  });

  it('converte o kickoff de milissegundos para segundos', () => {
    const e = eventos.find((x) => x.idNaCasa === '13933710')!;
    expect(e.kickoffUnix).toBe(1786579200);
    expect(new Date(e.kickoffUnix * 1000).toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('traz competicao e betradarId — as duas chaves de pareamento', () => {
    const e = eventos.find((x) => x.idNaCasa === '13933710')!;
    expect(e.competicaoNaCasa).toBe('90153');
    expect(e.betradarId).toBe('69652948');
    // O atalho exato so vale a pena se a cobertura for alta.
    const comBetradar = eventos.filter((x) => x.betradarId).length;
    expect(comBetradar / eventos.length).toBeGreaterThan(0.9);
  });

  it('todas as odds sao apostaveis: finitas e maiores que 1', () => {
    for (const e of eventos) {
      for (const odd of [e.casa, e.empate, e.fora]) {
        expect(Number.isFinite(odd)).toBe(true);
        expect(odd).toBeGreaterThan(1);
      }
    }
  });

  it('o juice de cada casa fica em faixa plausivel — pega preco lido do campo errado', () => {
    // 1/casa + 1/empate + 1/fora deve ficar um pouco acima de 1. Muito longe
    // disso significa que `preco` apontou para outro campo (ex.: `outcomeId`).
    for (const e of eventos) {
      const s = 1 / e.casa + 1 / e.empate + 1 / e.fora;
      expect(s).toBeGreaterThan(1.0);
      expect(s).toBeLessThan(1.3);
    }
  });
});

describe('extrairEventos — descarte seguro', () => {
  const extracao = config.extracao;

  it('descarta evento cujo matchName nao parte em exatamente dois', () => {
    // Nome com o separador dentro partiria errado e viraria pareamento errado.
    const r = extrairEventos(
      { data: [{ ...fixture.data[0], matchName: 'A·B·C' }] },
      extracao,
    );
    expect(r).toHaveLength(0);
  });

  it('descarta a casa inteira quando uma perna esta suspensa', () => {
    const evento = structuredClone(fixture.data.find((e: { odds: unknown[] }) => e.odds.length >= 3));
    evento.odds[0].status = 'suspended';
    expect(extrairEventos({ data: [evento] }, extracao)).toHaveLength(0);
  });

  it('descarta evento sem kickoff valido', () => {
    const evento = structuredClone(fixture.data[0]);
    evento.unixDateMillis = null;
    expect(extrairEventos({ data: [evento] }, extracao)).toHaveLength(0);
  });

  it('nao explode com resposta de formato inesperado', () => {
    expect(extrairEventos({}, extracao)).toEqual([]);
    expect(extrairEventos({ data: 'nao e lista' }, extracao)).toEqual([]);
    expect(extrairEventos(null, extracao)).toEqual([]);
  });
});

describe('montarUrl', () => {
  const agora = new Date('2026-08-12T15:00:00Z');

  it('substitui data e dataFim em UTC', () => {
    const url = montarUrl(config.requisicao.url, { dia: 1, agora });
    expect(url).toContain('startDate=2026-08-13%2000:00:00');
    expect(url).toContain('endDate=2026-08-14%2000:00:00');
  });

  it('vira o mes corretamente', () => {
    const url = montarUrl('{data}..{dataFim}', {
      dia: 0,
      agora: new Date('2026-08-31T23:00:00Z'),
    });
    expect(url).toBe('2026-08-31..2026-09-01');
  });

  it('preenche competitionId quando a casa so busca por liga', () => {
    expect(montarUrl('x/{competitionId}/y', { dia: 0, competitionId: '42', agora })).toBe(
      'x/42/y',
    );
  });
});

describe('pegar', () => {
  it('navega caminho aninhado', () => {
    expect(pegar({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
  });

  it('devolve undefined em vez de lancar quando o caminho nao existe', () => {
    expect(pegar({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(pegar(null, 'a')).toBeUndefined();
  });
});
