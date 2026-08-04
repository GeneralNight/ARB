import { describe, expect, it } from 'vitest';
import {
  DEGRAU_REALERTA_PP,
  anteriorDaFamilia,
  bestLine,
  dedupeKey,
  deveAlertar,
  familiaDaChave,
  impliedSum,
  mereceRealerta,
  montarAposta,
  roi,
  type Aposta,
  type OddsCasa,
} from './calc.js';
import { intervaloMinutos } from './scanner.js';

const book = (id: number, casa: number, empate: number, fora: number): OddsCasa => ({
  bookmakerId: id,
  nome: `casa${id}`,
  casa,
  empate,
  fora,
});

describe('impliedSum / roi', () => {
  it('reproduz a margem real medida no Platense x Talleres', () => {
    // Melhor linha combinada observada em 03/08/2026 com 24 casas.
    const s = impliedSum(2.7, 2.85, 3.36);
    expect(s).toBeCloseTo(1.01887, 5);
    expect(roi(s)).toBeLessThan(0); // margem positiva = vantagem da casa
  });

  it('reconhece uma arbitragem classica', () => {
    const s = impliedSum(2.6, 3.6, 3.4);
    expect(s).toBeCloseTo(0.95651, 5);
    expect(roi(s) * 100).toBeCloseTo(4.55, 1);
  });
});

describe('bestLine', () => {
  it('exige tres casas distintas', () => {
    // A casa 1 tem a melhor odd de casa E de empate. A escolha gulosa pegaria
    // as duas dela; a linha valida precisa ceder o empate para outra casa.
    const linha = bestLine([
      book(1, 3.0, 3.9, 2.0),
      book(2, 2.5, 3.5, 3.0),
      book(3, 2.4, 3.4, 3.2),
    ])!;
    const ids = [linha.casa.bookmakerId, linha.empate.bookmakerId, linha.fora.bookmakerId];
    expect(new Set(ids).size).toBe(3);
    expect(linha.casa.bookmakerId).toBe(1);
  });

  it('acha o S minimo entre combinacoes validas', () => {
    const linha = bestLine([
      book(1, 2.6, 3.0, 3.0),
      book(2, 2.4, 3.6, 3.0),
      book(3, 2.4, 3.0, 3.4),
    ])!;
    expect(linha.s).toBeCloseTo(impliedSum(2.6, 3.6, 3.4), 6);
    expect(linha.margemPct).toBeLessThan(0);
  });

  it('devolve null com menos de tres casas', () => {
    expect(bestLine([book(1, 2.6, 3.6, 3.4), book(2, 2.5, 3.5, 3.3)])).toBeNull();
  });

  it('ignora odds invalidas ou <= 1', () => {
    const linha = bestLine([
      book(1, 2.6, 3.6, 3.4),
      book(2, 2.5, 3.5, 3.3),
      book(3, 2.4, 3.4, 3.2),
      book(4, 0, 0, 0),
      book(5, Number.NaN, 3.5, 3.5),
    ])!;
    expect(linha.bookCount).toBe(3);
  });
});

describe('montarAposta', () => {
  it('iguala os retornos dos tres cenarios e gera lucro', () => {
    const linha = bestLine([
      book(1, 2.6, 3.0, 3.0),
      book(2, 2.4, 3.6, 3.0),
      book(3, 2.4, 3.0, 3.4),
    ])!;
    const aposta = montarAposta(linha, 1000, 1);

    expect(aposta.isArb).toBe(true);
    expect(aposta.lucroPiorCaso).toBeGreaterThan(0);

    // Propriedade central da arbitragem: da no mesmo qual resultado sair.
    const retornos = aposta.pernas.map((p) => p.retorno);
    const spread = Math.max(...retornos) - Math.min(...retornos);
    expect(spread).toBeLessThan(5); // folga do arredondamento em R$ 1

    for (const r of retornos) expect(r).toBeGreaterThan(aposta.total);
  });

  it('nao marca isArb quando nao ha arbitragem', () => {
    const linha = bestLine([
      book(1, 2.7, 2.5, 3.0),
      book(2, 2.5, 2.85, 3.0),
      book(3, 2.5, 2.5, 3.36),
    ])!;
    const aposta = montarAposta(linha, 1000, 1);
    expect(aposta.s).toBeCloseTo(1.01887, 4);
    expect(aposta.isArb).toBe(false);
    expect(aposta.lucroPiorCaso).toBeLessThan(0);
  });

  it('o total apostado respeita a banca', () => {
    const linha = bestLine([
      book(1, 2.6, 3.0, 3.0),
      book(2, 2.4, 3.6, 3.0),
      book(3, 2.4, 3.0, 3.4),
    ])!;
    const aposta = montarAposta(linha, 500, 1);
    expect(aposta.total).toBeLessThanOrEqual(501);
    expect(aposta.total).toBeGreaterThan(495);
  });

  it('rejeita arb marginal que o arredondamento destroi', () => {
    // ROI teorico positivo mas minusculo; com stakes em multiplos de R$ 50 o
    // desequilibrio entre as pernas come o lucro inteiro.
    const linha = bestLine([
      book(1, 3.02, 3.0, 3.0),
      book(2, 3.0, 3.02, 3.0),
      book(3, 3.0, 3.0, 3.02),
    ])!;
    expect(roi(linha.s)).toBeGreaterThan(0); // existe no papel

    const grosseiro = montarAposta(linha, 1000, 50);
    expect(grosseiro.isArb).toBe(false); // some na pratica
    expect(deveAlertar(grosseiro, 0)).toBe(false);

    const fino = montarAposta(linha, 1000, 1);
    expect(fino.isArb).toBe(true); // sobrevive com incremento de R$ 1
  });
});

describe('deveAlertar', () => {
  const linha = bestLine([
    book(1, 2.6, 3.0, 3.0),
    book(2, 2.4, 3.6, 3.0),
    book(3, 2.4, 3.0, 3.4),
  ])!;
  const aposta = montarAposta(linha, 1000, 1); // ~ +2,1%

  it('respeita o limiar configurado', () => {
    expect(aposta.roiPct).toBeGreaterThan(1.5);
    expect(deveAlertar(aposta, 1.5)).toBe(true);
    expect(deveAlertar(aposta, 5)).toBe(false);
  });

  it('com limiar >= 0 nunca alerta prejuizo', () => {
    const semArb = montarAposta(
      bestLine([
        book(1, 2.7, 2.5, 3.0),
        book(2, 2.5, 2.85, 3.0),
        book(3, 2.5, 2.5, 3.36),
      ])!,
      1000,
      1,
    );
    expect(deveAlertar(semArb, 0)).toBe(false);
  });

  it('limiar negativo habilita o modo calibracao', () => {
    const semArb = montarAposta(
      bestLine([
        book(1, 2.7, 2.5, 3.0),
        book(2, 2.5, 2.85, 3.0),
        book(3, 2.5, 2.5, 3.36),
      ])!,
      1000,
      1,
    );
    // Quase-arb de ~ -1,85%: silencioso em -1, visivel em -3.
    expect(deveAlertar(semArb, -1)).toBe(false);
    expect(deveAlertar(semArb, -3)).toBe(true);
  });
});

describe('re-alerta do mesmo trio', () => {
  // So roiPct e isArb importam para a decisao; o resto e enfeite.
  const aposta = (roiPct: number, isArb = roiPct > 0): Aposta => ({
    s: 1,
    roiPct,
    total: 1000,
    pernas: [],
    lucroPiorCaso: isArb ? 1 : -1,
    isArb,
  });
  const antes = (chave: string, roiPct: number, isArb = roiPct > 0) => ({ chave, roiPct, isArb });

  it('trio inedito sempre alerta', () => {
    expect(mereceRealerta(null, aposta(-0.5))).toBe(true);
  });

  it('cala a oscilacao que nao muda nada', () => {
    // Caso real de 04/08/2026: r9z6gEre alertou a -0,32% e ficou meia hora
    // oscilando entre -0,32% e -0,10% no mesmo trio. Uma mensagem basta.
    expect(mereceRealerta(antes('k@0', -0.32), aposta(-0.1))).toBe(false);
  });

  it('volta a falar quando o quase-arb vira arbitragem de verdade', () => {
    // Melhora de so 0,37 p.p. — abaixo do degrau — mas cruzou para lucro real,
    // que e a mensagem que o robo existe para mandar.
    expect(0.05 - -0.32).toBeLessThan(DEGRAU_REALERTA_PP);
    expect(mereceRealerta(antes('k@0', -0.32), aposta(0.05))).toBe(true);
  });

  it('volta a falar quando melhora um degrau inteiro', () => {
    expect(mereceRealerta(antes('k@0', -1.0), aposta(-0.4))).toBe(true);
    expect(mereceRealerta(antes('k@0', -1.0), aposta(-0.6))).toBe(false);
  });

  it('nunca repete por piora', () => {
    expect(mereceRealerta(antes('k@0', 0.5), aposta(0.1))).toBe(false);
    expect(mereceRealerta(antes('k@0', 0.5), aposta(-2))).toBe(false);
  });

  it('compara contra o MELHOR ja enviado, nao contra o ultimo', () => {
    // Senao um vai-e-volta -0,1 → -1,0 → -0,1 mandaria mensagem a cada volta.
    const historico = [antes('jogo#trio@0', -0.1), antes('jogo#trio@1', -1.0)];
    const { melhor, quantos } = anteriorDaFamilia('jogo#trio', historico);
    expect(melhor?.roiPct).toBe(-0.1);
    expect(quantos).toBe(2);
    expect(mereceRealerta(melhor, aposta(-0.1))).toBe(false);
  });

  it('separa familias e entende chave antiga sem sufixo', () => {
    const historico = [
      antes('jogo#trioA', -0.3), // linha gravada antes do sufixo @n existir
      antes('jogo#trioB@0', 2.0),
    ];
    expect(familiaDaChave('jogo#trioA')).toBe('jogo#trioA');
    expect(anteriorDaFamilia('jogo#trioA', historico).melhor?.roiPct).toBe(-0.3);
    expect(anteriorDaFamilia('jogo#trioC', historico).melhor).toBeNull();
    expect(anteriorDaFamilia('jogo#trioC', historico).quantos).toBe(0);
  });

  it('a chave gravada deriva da familia e nao colide entre re-alertas', () => {
    const linha = bestLine([
      book(1, 2.6, 3.0, 3.0),
      book(2, 2.4, 3.6, 3.0),
      book(3, 2.4, 3.0, 3.4),
    ])!;
    const familia = dedupeKey('jogo1', montarAposta(linha, 1000, 1).pernas);
    const chaves = [0, 1, 2].map((n) => `${familia}@${n}`);
    expect(new Set(chaves).size).toBe(3);
    for (const c of chaves) expect(familiaDaChave(c)).toBe(familia);
  });
});

describe('intervaloMinutos (cadencia)', () => {
  it('rareia conforme o jogo esta mais longe', () => {
    expect(intervaloMinutos(10)).toBe(2); // faltando 10 min
    expect(intervaloMinutos(3 * 60)).toBe(10); // 3 horas
    expect(intervaloMinutos(12 * 60)).toBe(30); // 12 horas
    expect(intervaloMinutos(40 * 60)).toBe(120); // 40 horas
  });

  it('nunca fica mais lento perto do apito', () => {
    let anterior = Number.POSITIVE_INFINITY;
    for (const h of [48, 30, 24, 12, 6, 3, 2, 1, 0.5]) {
      const atual = intervaloMinutos(h * 60);
      expect(atual).toBeLessThanOrEqual(anterior);
      anterior = atual;
    }
  });

  it('jogo distante nao consome banda a toa', () => {
    // Sem a faixa de 24h+, ampliar a janela para varios dias multiplicaria o
    // download sem ganhar oportunidade — odds a 40h de distancia nao se mexem.
    expect(intervaloMinutos(40 * 60)).toBeGreaterThan(intervaloMinutos(12 * 60));
  });
});

describe('dedupeKey', () => {
  it('e estavel para o mesmo trio e muda quando a casa muda', () => {
    const linha = bestLine([
      book(1, 2.6, 3.0, 3.0),
      book(2, 2.4, 3.6, 3.0),
      book(3, 2.4, 3.0, 3.4),
    ])!;
    const a = montarAposta(linha, 1000, 1);
    const b = montarAposta(linha, 2000, 1);
    expect(dedupeKey('evt1', a.pernas)).toBe(dedupeKey('evt1', b.pernas));
    expect(dedupeKey('evt1', a.pernas)).not.toBe(dedupeKey('evt2', a.pernas));
  });
});
