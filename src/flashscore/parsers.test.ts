/**
 * Testes contra os payloads reais capturados do Flashscore em 03/08/2026.
 * Se o formato mudar, e aqui que aparece primeiro.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bestLine } from '../arb/calc.js';
import { apenasPreJogo, parseFeed } from './feed.js';
import { parseOdds } from './odds.js';

const feedRaw = readFileSync('fixtures/feed-sample.txt', 'utf8');
const oddsRaw = JSON.parse(readFileSync('fixtures/odds-sample.json', 'utf8'));

describe('parseFeed', () => {
  const feed = parseFeed(feedRaw);

  it('extrai ligas e jogos do formato delimitado', () => {
    expect(feed.ligas.length).toBe(63);
    expect(feed.jogos.length).toBe(200);
  });

  it('nao perde jogos que vem sem o campo AE', () => {
    // ~2% dos jogos trazem o mandante so em CX. Ignorar isso descartava jogos
    // em silencio — e jogo descartado e arbitragem perdida sem aviso.
    const semAE = feed.jogos.find((j) => j.id === 'htkRizMa')!;
    expect(semAE).toBeDefined();
    expect(semAE.mandante).toBeTruthy();
    expect(semAE.visitante).toBe('Bayern Munich (Ger)');
  });

  it('associa cada jogo a sua liga', () => {
    const jogo = feed.jogos.find((j) => j.id === 'A9tzvkkC')!;
    expect(jogo.mandante).toBe('Platense');
    expect(jogo.visitante).toBe('Talleres Cordoba');
    expect(jogo.ligaId).toBe('naYhNOaA');
    expect(jogo.ligaNome).toContain('Liga Profesional');
  });

  it('le o kickoff como data valida', () => {
    for (const j of feed.jogos) {
      expect(j.kickoff.getTime()).toBeGreaterThan(0);
      expect(Number.isNaN(j.kickoff.getTime())).toBe(false);
    }
  });

  it('deriva o pais do nome da liga', () => {
    const liga = feed.ligas.find((l) => l.id === 'naYhNOaA')!;
    expect(liga.pais).toBe('ARGENTINA');
    expect(liga.urlPath).toContain('/football/argentina/');
  });
});

describe('apenasPreJogo', () => {
  const feed = parseFeed(feedRaw);

  it('descarta jogos ja iniciados', () => {
    const primeiro = feed.jogos[0]!;
    const depois = new Date(primeiro.kickoff.getTime() + 60 * 60_000);
    const restantes = apenasPreJogo(feed.jogos, 5, depois);
    expect(restantes).not.toContainEqual(primeiro);
  });

  it('respeita a margem de minutos antes do inicio', () => {
    const alvo = feed.jogos[0]!;
    // 3 minutos antes do apito, com margem de 5: deve ficar de fora.
    const agora = new Date(alvo.kickoff.getTime() - 3 * 60_000);
    expect(apenasPreJogo([alvo], 5, agora)).toHaveLength(0);
    expect(apenasPreJogo([alvo], 1, agora)).toHaveLength(1);
  });
});

describe('parseOdds', () => {
  const odds = parseOdds(oddsRaw)!;

  it('extrai as 24 casas com 1X2 tempo integral', () => {
    expect(odds.eventId).toBe('A9tzvkkC');
    expect(odds.casas.length).toBe(24);
  });

  it('resolve o nome das casas a partir de settings.bookmakers', () => {
    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.nome).toBe('bet365');
    const betano = odds.casas.find((c) => c.bookmakerId === 574)!;
    expect(betano.nome).toContain('Betano');
    // Nenhuma casa deve cair no fallback "#id".
    expect(odds.casas.filter((c) => c.nome.startsWith('#'))).toHaveLength(0);
  });

  it('mapeia casa/empate/fora corretamente', () => {
    // Valores conferidos na tabela do site para a bet365 nesse jogo.
    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.casa).toBe(2.55);
    expect(bet365.empate).toBe(2.75);
    expect(bet365.fora).toBe(3.2);
  });

  it('todas as odds sao numeros plausiveis', () => {
    for (const c of odds.casas) {
      for (const v of [c.casa, c.empate, c.fora]) {
        expect(v).toBeGreaterThan(1);
        expect(v).toBeLessThan(100);
      }
    }
  });

  it('reproduz a margem de 1,89% medida no reconhecimento', () => {
    const linha = bestLine(odds.casas)!;
    expect(linha.margemPct).toBeCloseTo(1.89, 1);
    expect(linha.bookCount).toBe(24);
    // Sem arbitragem neste jogo: margem positiva e vantagem da casa.
    expect(linha.margemPct).toBeGreaterThan(0);
    const ids = [linha.casa.bookmakerId, linha.empate.bookmakerId, linha.fora.bookmakerId];
    expect(new Set(ids).size).toBe(3);
  });
});
