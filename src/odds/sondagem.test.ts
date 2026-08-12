import { describe, expect, it } from 'vitest';
import { acharPlataforma, classificar, type RespostaSondada } from './sondagem.js';

/**
 * Os casos abaixo sao respostas REAIS medidas em 12/08/2026. Se a classificacao
 * mudar, e porque alguem mexeu no criterio — nao porque a casa mudou.
 */

const base: RespostaSondada = { status: 200, cfMitigated: null, servidor: null, corpo: '' };

describe('classificar', () => {
  it('separa desafio JS de negacao pura — os dois sao 403 com corpo vazio', () => {
    // KTO e Novibet: o Cloudflare avisa que aplicou desafio.
    const kto = classificar({
      ...base,
      status: 403,
      cfMitigated: 'challenge',
      servidor: 'cloudflare',
    });
    expect(kto.acesso).toBe('desafio-js');

    // Mesmo 403, mesmo corpo vazio, sem cf-mitigated. Caso muito pior.
    const semCorpo = classificar({ ...base, status: 403, servidor: 'cloudflare' });
    expect(semCorpo.acesso).toBe('negada');
  });

  it('nao confunde pagina de bloqueio do Cloudflare com portao da casa', () => {
    // Caso real do bet365: 4549 bytes, tamanho de pagina de verdade. Sem esta
    // regra ele caia em "portao proprio" — diagnostico invertido, porque portao
    // proprio e barato de resolver e WAF nao e.
    const bet365 = classificar({
      ...base,
      status: 403,
      servidor: 'cloudflare',
      corpo:
        '<html><head><title>Attention Required! | Cloudflare</title></head>' +
        `<body>${'x'.repeat(4000)}</body></html>`,
    });
    expect(bet365.acesso).toBe('negada');
    expect(bet365.detalhe).toContain('WAF');
  });

  it('reconhece portao proprio pelo corpo: 403 com pagina de verdade nao e anti-bot', () => {
    const betano = classificar({
      ...base,
      status: 403,
      servidor: 'cloudflare',
      corpo: `<html><head><title>Betano Splash Screen</title></head><body>${'x'.repeat(1500)}</body></html>`,
    });
    expect(betano.acesso).toBe('portao-proprio');
    expect(betano.detalhe).toContain('Betano Splash Screen');
  });

  it('desafio JS ganha do corpo: cf-mitigated e evidencia direta, tamanho e indicio', () => {
    const r = classificar({
      ...base,
      status: 403,
      cfMitigated: 'challenge',
      corpo: '<html>'.padEnd(3000, 'x'),
    });
    expect(r.acesso).toBe('desafio-js');
  });

  it('trata 2xx e 3xx como aberta — casa que redireciona nao esta bloqueada', () => {
    expect(classificar({ ...base, status: 200, corpo: 'ok' }).acesso).toBe('aberta');
    expect(classificar({ ...base, status: 301 }).acesso).toBe('aberta');
  });

  it('erro de rede vira fora-do-ar, e nao negada', () => {
    const r = classificar({ ...base, status: 0, erro: 'fetch failed' });
    expect(r.acesso).toBe('fora-do-ar');
    expect(r.detalhe).toBe('fetch failed');
  });

  it('detecta plataforma mesmo quando a casa esta bloqueada', () => {
    // O HTML pode vazar a plataforma antes de o anti-bot fechar o resto.
    const r = classificar({
      ...base,
      status: 403,
      cfMitigated: 'challenge',
      corpo: 'x'.repeat(400) + 'sb2wsdk-altenar2.biahosted.com',
    });
    expect(r.acesso).toBe('desafio-js');
    expect(r.plataforma).toBe('Altenar');
  });
});

describe('acharPlataforma', () => {
  it('acha Altenar pelo host do widget (caso real da Esportivabet)', () => {
    expect(acharPlataforma('<script src="https://sb2wsdk-altenar2.biahosted.com/x.js">')).toBe(
      'Altenar',
    );
  });

  it('acha Mitmegas (caso real da Galerabet)', () => {
    expect(acharPlataforma('fetch("https://oapi-cf.mitmegas2.com/v1")')).toBe('Mitmegas');
  });

  it('devolve null quando a SPA nao entrega nada no HTML', () => {
    expect(acharPlataforma('<div id="app"></div>')).toBeNull();
  });
});
