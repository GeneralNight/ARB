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

  /**
   * Direcao de mandante/visitante — corrigida em 12/08/2026.
   *
   * O payload nao rotula os participantes (nao existe `participantId`,
   * `homeAway` nem `side`): a ordem de aparicao e o unico sinal, e ela e
   * VISITANTE primeiro. A versao anterior assumia o contrario.
   *
   * A prova nao foi palpite futebolistico: comparando com a odd direta da
   * Superbet, o proprio texto dela dizia "FC Copenhagen vence a partida" para a
   * cotacao 1,19, enquanto este parser punha 11,00 no Copenhagen. Nos 19 jogos
   * pareados naquela rodada, os 19 vieram com empate identico e casa/fora
   * trocados — inversao sistematica, nao caso isolado.
   *
   * O erro se escondia porque `bestLine` continuava certo: S e a soma dos tres
   * maximos, e trocar dois rotulos nao muda a soma. So o alerta mentia, mandando
   * apostar no mandante pelo preco do visitante.
   */
  it('usa o SEGUNDO participante do payload como mandante', () => {
    const linhas = (oddsRaw as any).data.findOddsByEventId.odds.filter(
      (o: any) => o.bettingType === 'HOME_DRAW_AWAY' && o.bettingScope === 'FULL_TIME',
    );
    const ordem: string[] = [];
    for (const linha of linhas) {
      for (const item of linha.odds) {
        if (item.eventParticipantId && !ordem.includes(item.eventParticipantId)) {
          ordem.push(item.eventParticipantId);
        }
      }
    }
    const [idVisitante, idMandante] = ordem;

    const linhaBet365 = linhas.find((l: any) => l.bookmakerId === 16)!;
    const valor = (id: string | null) =>
      Number(linhaBet365.odds.find((o: any) => o.eventParticipantId === id).value);

    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.casa).toBe(valor(idMandante!));
    expect(bet365.fora).toBe(valor(idVisitante!));
    expect(bet365.empate).toBe(valor(null));
  });

  it('mapeia casa/empate/fora nos valores esperados', () => {
    // Jogo do fixture: Platense (mandante) x Talleres Cordoba (visitante),
    // Liga Profesional Argentina. Valores da bet365 sob a direcao corrigida.
    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.casa).toBe(3.2);
    expect(bet365.empate).toBe(2.75);
    expect(bet365.fora).toBe(2.55);
  });

  it('a inversao NAO muda a margem — e por isso o bug ficou escondido', () => {
    // Prova da propriedade que enganou: S soma os tres maximos, entao trocar
    // dois rotulos deixa o ROI identico. Quem so olhasse a margem nao veria nada.
    const invertidas = odds.casas.map((c) => ({ ...c, casa: c.fora, fora: c.casa }));
    expect(bestLine(invertidas)!.margemPct).toBeCloseTo(bestLine(odds.casas)!.margemPct, 6);
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
