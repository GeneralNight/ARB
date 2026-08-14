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
   * Direcao de mandante/visitante.
   *
   * O payload nao rotula os participantes (nao existe `participantId`,
   * `homeAway` nem `side`): a ordem de aparicao e o unico sinal, e ela e
   * MANDANTE primeiro.
   *
   * Este teste trava o CODIGO contra alguem reinverter sem querer. Ele nao
   * detecta o payload virar — fixture e captura estatica. Quem detecta isso e
   * `npm run divergencia`, contra casas diretas de rotulo explicito.
   */
  it('usa o PRIMEIRO participante do payload como mandante', () => {
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
    const [idMandante, idVisitante] = ordem;

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
    // Liga Profesional Argentina.
    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.casa).toBe(2.55);
    expect(bet365.empate).toBe(2.75);
    expect(bet365.fora).toBe(3.2);
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

/**
 * Direcao ancorada em realidade, nao em convencao.
 *
 * O teste acima prova que o parser e coerente com a ordem do payload — mas
 * seria igualmente verde com a regra invertida, porque so compara o parser
 * consigo mesmo. Este aqui e diferente: usa um jogo cujo favorito nao admite
 * discussao, entao ele so passa se o rotulo estiver CERTO.
 *
 * Rio Ave x Porto (Liga Portugal, capturado em 14/08/2026): o Porto e o
 * visitante, e nas 26 casas ele paga ~1,40 contra ~7,40 do Rio Ave. Se o
 * parser puser o mandante como favorito, este teste cai.
 *
 * Fixture enxuto de proposito: so as linhas 1X2 tempo integral mais o
 * `settings`. E captura real, nao mock — o payload cheio (~420 mercados,
 * 900 KB) continua em `odds-sample.json`, que e quem vigia o formato.
 */
describe('parseOdds — direcao contra jogo de favorito obvio', () => {
  const direcaoRaw = JSON.parse(readFileSync('fixtures/odds-direcao.json', 'utf8'));
  const odds = parseOdds(direcaoRaw)!;

  it('le o jogo inteiro', () => {
    expect(odds.eventId).toBe('KWjl4hph');
    expect(odds.casas).toHaveLength(26);
  });

  it('poe o visitante favorito como FORA, nao como casa', () => {
    const bet365 = odds.casas.find((c) => c.bookmakerId === 16)!;
    expect(bet365.casa).toBe(8.0); // Rio Ave, mandante azarao
    expect(bet365.empate).toBe(4.5);
    expect(bet365.fora).toBe(1.37); // Porto, visitante favorito
  });

  it('em TODAS as casas o mandante paga mais que o visitante', () => {
    // Propriedade, nao valor: sobrevive a odd se mexer entre capturas, e e
    // exatamente o que a inversao quebraria.
    for (const c of odds.casas) {
      expect(c.casa).toBeGreaterThan(c.fora);
    }
  });
});
