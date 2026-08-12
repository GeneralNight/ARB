import { describe, expect, it } from 'vitest';
import {
  MARGEM_MINIMA,
  SCORE_MINIMO,
  derivarCompeticoes,
  normalizarTime,
  parear,
  parearCompeticao,
  pontuar,
} from './pareamento.js';
import type { EventoDaCasa } from './tipos.js';

const KICKOFF = 1786579200;

function evento(p: Partial<EventoDaCasa> & { mandante: string; visitante: string }): EventoDaCasa {
  return {
    idNaCasa: `${p.mandante}-${p.visitante}`,
    kickoffUnix: KICKOFF,
    casa: 2,
    empate: 3.4,
    fora: 3.6,
    ...p,
  };
}

describe('normalizarTime', () => {
  it('tira acento e caixa', () => {
    expect(normalizarTime('Atlético-MG')).toBe('atletico mg');
    expect(normalizarTime('São Paulo')).toBe('sao paulo');
    expect(normalizarTime('Grêmio')).toBe('gremio');
  });

  it('remove ruido societario', () => {
    expect(normalizarTime('FC Barcelona')).toBe('barcelona');
    expect(normalizarTime('Liverpool FC')).toBe('liverpool');
  });

  it('PRESERVA o sufixo de time reserva — apagar fundiria dois times diferentes', () => {
    expect(normalizarTime('JJK Jyvaskyla II')).toContain('ii');
    expect(normalizarTime('Bayern U21')).toContain('u21');
    expect(normalizarTime('JJK Jyvaskyla')).not.toBe(normalizarTime('JJK Jyvaskyla II'));
  });

  it('nao devolve string vazia quando o nome e so ruido', () => {
    expect(normalizarTime('FC')).toBe('fc');
  });
});

describe('pontuar', () => {
  it('passa a variacao de nome real e barra o time diferente', () => {
    const variacao = pontuar('Atlético-MG', 'Atletico Mineiro');
    const outroTime = pontuar('Atletico Mineiro', 'Atletico Paranaense');
    expect(variacao).toBeGreaterThanOrEqual(SCORE_MINIMO);
    expect(outroTime).toBeLessThan(SCORE_MINIMO);
    expect(variacao).toBeGreaterThan(outroTime);
  });

  it('da 1 para nomes que normalizam igual', () => {
    expect(pontuar('Manchester City', 'manchester city')).toBe(1);
    expect(pontuar('FC Barcelona', 'Barcelona')).toBe(1);
  });
});

describe('parear', () => {
  it('usa betradarId como atalho exato, ignorando o nome', () => {
    const alvo = evento({ mandante: 'Grafia impossivel', visitante: 'Outra', betradarId: '999' });
    const r = parear(
      { mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF, betradarId: '999' },
      [evento({ mandante: 'Monterrey', visitante: 'Nashville' }), alvo],
    );
    expect(r?.via).toBe('betradar');
    expect(r?.evento).toBe(alvo);
  });

  it('recusa quando dois eventos tem o mesmo betradarId — dado corrompido nao se adivinha', () => {
    const r = parear(
      { mandante: 'A', visitante: 'B', kickoffUnix: KICKOFF, betradarId: '7' },
      [
        evento({ mandante: 'A', visitante: 'B', betradarId: '7' }),
        evento({ mandante: 'A', visitante: 'B', betradarId: '7', idNaCasa: 'outro' }),
      ],
    );
    expect(r).toBeNull();
  });

  it('pareia por nome quando nao ha betradarId', () => {
    const r = parear({ mandante: 'Atlético-MG', visitante: 'São Paulo', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'Atletico Mineiro', visitante: 'Sao Paulo' }),
    ]);
    expect(r?.via).toBe('nome');
    expect(r?.score).toBeGreaterThanOrEqual(SCORE_MINIMO);
  });

  it('exige acerto nos DOIS times — mandante certo e visitante errado e par errado', () => {
    const r = parear({ mandante: 'Atlético-MG', visitante: 'São Paulo', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'Atletico Mineiro', visitante: 'Palmeiras' }),
    ]);
    expect(r).toBeNull();
  });

  it('recusa empate tecnico entre dois candidatos parecidos', () => {
    // Time principal e reserva no mesmo horario: recusar e o comportamento certo.
    const r = parear({ mandante: 'JJK Jyvaskyla', visitante: 'JPS Jyvaskyla', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'JJK Jyvaskyla II', visitante: 'JPS Jyvaskyla' }),
      evento({ mandante: 'JJK Jyvaskyla III', visitante: 'JPS Jyvaskyla' }),
    ]);
    expect(r).toBeNull();
  });

  it('descarta candidato fora da janela de kickoff', () => {
    const r = parear({ mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF + 4 * 3600 }),
    ]);
    expect(r).toBeNull();
  });

  it('aceita diferenca pequena de horario entre as fontes', () => {
    const r = parear({ mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF + 15 * 60 }),
    ]);
    expect(r).not.toBeNull();
  });

  it('devolve null com lista vazia', () => {
    expect(parear({ mandante: 'A', visitante: 'B', kickoffUnix: KICKOFF }, [])).toBeNull();
  });

  it('nao inverte mandante e visitante', () => {
    // Jogo espelhado e outra partida. Aceitar seria trocar Casa por Fora no calc.
    const r = parear({ mandante: 'Monterrey', visitante: 'Nashville', kickoffUnix: KICKOFF }, [
      evento({ mandante: 'Nashville', visitante: 'Monterrey' }),
    ]);
    expect(r).toBeNull();
  });
});

describe('parearCompeticao', () => {
  it('ignora o patrocinador no nome da liga', () => {
    const r = parearCompeticao('Brasileirão Série A', [
      { id: '1', nome: 'Brasileirao Betano Serie A' },
      { id: '2', nome: 'Brasileirao Serie B' },
    ]);
    expect(r?.item.id).toBe('1');
  });

  it('separa divisoes que diferem por UM caractere — o caso que Dice perde', () => {
    const r = parearCompeticao('Bundesliga II', [
      { id: '1', nome: 'Bundesliga' },
      { id: '2', nome: 'Bundesliga II' },
    ]);
    expect(r?.item.id).toBe('2');
  });

  it('recusa quando duas ligas ficam empatadas', () => {
    const r = parearCompeticao('Segunda Divisao', [
      { id: '1', nome: 'Segunda Divisao A' },
      { id: '2', nome: 'Segunda Divisao B' },
    ]);
    expect(r).toBeNull();
  });

  it('recusa quando nada chega perto', () => {
    expect(parearCompeticao('Premier League', [{ id: '1', nome: 'Liga dos Campeoes' }])).toBeNull();
  });

  it('um token em comum e coincidencia, nao pareamento', () => {
    // "Liga" sozinho casaria com toda liga do catalogo.
    expect(
      parearCompeticao('Liga dos Campeoes', [{ id: '1', nome: 'Liga Portugal' }]),
    ).toBeNull();
  });
});

describe('derivarCompeticoes', () => {
  it('deriva a liga da maioria dos jogos ja pareados', () => {
    const r = derivarCompeticoes([
      { competitionId: 'Yq4hUnzQ', competicaoNaCasa: '90153' },
      { competitionId: 'Yq4hUnzQ', competicaoNaCasa: '90153' },
      { competitionId: 'Yq4hUnzQ', competicaoNaCasa: '90153' },
    ]);
    expect(r).toEqual([{ competitionId: 'Yq4hUnzQ', competicaoNaCasa: '90153', score: 1 }]);
  });

  it('tolera um voto divergente sem descartar a liga', () => {
    const votos = Array.from({ length: 9 }, () => ({
      competitionId: 'L',
      competicaoNaCasa: 'A',
    }));
    votos.push({ competitionId: 'L', competicaoNaCasa: 'B' });
    const r = derivarCompeticoes(votos);
    expect(r[0]?.competicaoNaCasa).toBe('A');
    expect(r[0]?.score).toBeCloseTo(0.9);
  });

  it('recusa quando a liga se espalha entre torneios da casa', () => {
    // Casa que fatia por fase/grupo: mapear escolheria um pedaco e perderia o resto.
    const r = derivarCompeticoes([
      { competitionId: 'L', competicaoNaCasa: 'A' },
      { competitionId: 'L', competicaoNaCasa: 'B' },
      { competitionId: 'L', competicaoNaCasa: 'C' },
    ]);
    expect(r).toEqual([]);
  });

  it('ignora eventos sem competicao na casa', () => {
    expect(derivarCompeticoes([{ competitionId: 'L', competicaoNaCasa: '' }])).toEqual([]);
  });
});

describe('limiares', () => {
  it('estao em faixa defensavel', () => {
    expect(SCORE_MINIMO).toBeGreaterThan(0.5);
    expect(SCORE_MINIMO).toBeLessThan(0.8);
    expect(MARGEM_MINIMA).toBeGreaterThan(0);
  });
});
