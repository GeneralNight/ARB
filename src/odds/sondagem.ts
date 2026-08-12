/**
 * Classificacao de acesso das casas. Puro, sem I/O — o CLI faz a rede.
 *
 * Existe porque "403" nao e um diagnostico: as casas devolvem 403 por motivos
 * diferentes, com custos de solucao muito diferentes. Medido em 12/08/2026:
 *
 *   - KTO, Novibet  -> 403 + `cf-mitigated: challenge`, corpo vazio
 *                      = desafio JS do Cloudflare, resolvido por cookie
 *   - Betano        -> 403 sem `cf-mitigated`, corpo de 1649 bytes
 *                      ("Betano Splash Screen") = portao proprio, nem e anti-bot
 *   - bet365        -> 403 sem `cf-mitigated`, corpo vazio = negacao em WAF
 *
 * Tratar os tres como o mesmo problema e o erro caro aqui.
 */

export type Acesso = 'aberta' | 'desafio-js' | 'portao-proprio' | 'negada' | 'fora-do-ar';

export interface RespostaSondada {
  status: number;
  cfMitigated: string | null;
  servidor: string | null;
  corpo: string;
  erro?: string;
}

export interface Sondagem {
  acesso: Acesso;
  plataforma: string | null;
  detalhe: string;
}

/**
 * Assinaturas de plataforma de sportsbook no HTML.
 *
 * Vale mais que a classificacao de acesso: casa que roda em plataforma conhecida
 * herda um adaptador ja pronto. Um motor Altenar cobre varias casas de uma vez —
 * e o maior retorno por hora de todo o trabalho.
 */
const PLATAFORMAS: Array<[nome: string, padrao: RegExp]> = [
  ['Altenar', /altenar|biahosted/i],
  ['Kambi', /kambi(cdn)?/i],
  ['BetConstruct', /betconstruct|bcapps/i],
  ['Digitain', /digitain/i],
  ['Kaizen', /kaizengaming|kaizen-/i],
  ['Salsa', /salsatechnology|salsaomni/i],
  ['Superbet', /superbet-offer/i],
  ['Mitmegas', /mitmegas/i],
  ['Sportradar', /sportradar|betradar/i],
];

export function acharPlataforma(html: string): string | null {
  for (const [nome, padrao] of PLATAFORMAS) {
    if (padrao.test(html)) return nome;
  }
  return null;
}

/** Corpo curto demais para ser pagina de verdade — e so o codigo de erro. */
const CORPO_VAZIO = 200;

/**
 * Pagina de bloqueio do proprio Cloudflare.
 *
 * Sem isto o bet365 era classificado como "portao proprio" so porque devolve
 * 4549 bytes — mas o titulo e "Attention Required! | Cloudflare", ou seja e
 * bloqueio de WAF, nao portao de idade da casa. Confundir os dois inverte o
 * diagnostico: portao proprio e barato de resolver, WAF nao e.
 */
const BLOQUEIO_CF = /attention required|cf-error-details|cloudflare ray id|__cf_chl|<title>[^<]*cloudflare/i;

export function classificar(r: RespostaSondada): Sondagem {
  if (r.erro) {
    return { acesso: 'fora-do-ar', plataforma: null, detalhe: r.erro };
  }

  const plataforma = acharPlataforma(r.corpo);

  // Desafio JS: o Cloudflare diz explicitamente o que fez. E a melhor noticia
  // dentro do grupo bloqueado — resolve-se com cookie, sem navegador no ciclo.
  if (r.cfMitigated === 'challenge') {
    return {
      acesso: 'desafio-js',
      plataforma,
      detalhe: 'cf-mitigated: challenge — precisa de cf_clearance (porteiro)',
    };
  }

  if (r.status >= 200 && r.status < 400) {
    return {
      acesso: 'aberta',
      plataforma,
      detalhe: plataforma
        ? `HTTP ${r.status}, plataforma ${plataforma}`
        : `HTTP ${r.status}, ${(r.corpo.length / 1024).toFixed(0)} KB`,
    };
  }

  // Pagina de bloqueio do Cloudflare tem corpo grande, mas nao e portao da casa.
  if (BLOQUEIO_CF.test(r.corpo)) {
    return {
      acesso: 'negada',
      plataforma,
      detalhe: `HTTP ${r.status}, pagina de bloqueio do Cloudflare (WAF)`,
    };
  }

  // 403 com pagina de verdade nao e anti-bot: e portao de idade/regiao/consentimento.
  if (r.corpo.length > CORPO_VAZIO) {
    const titulo = /<title>(.*?)<\/title>/i.exec(r.corpo)?.[1]?.trim();
    return {
      acesso: 'portao-proprio',
      plataforma,
      detalhe: `HTTP ${r.status}, pagina de ${r.corpo.length} bytes${titulo ? ` ("${titulo}")` : ''}`,
    };
  }

  return {
    acesso: 'negada',
    plataforma,
    detalhe: `HTTP ${r.status}, corpo vazio — negacao em WAF/origem`,
  };
}

/** Ordem de ataque: primeiro o que custa menos para integrar. */
export const PESO_ACESSO: Record<Acesso, number> = {
  aberta: 0,
  'portao-proprio': 1,
  'desafio-js': 2,
  negada: 3,
  'fora-do-ar': 4,
};

export const ROTULO_ACESSO: Record<Acesso, string> = {
  aberta: 'aberta',
  'portao-proprio': 'portao proprio',
  'desafio-js': 'desafio JS',
  negada: 'negada',
  'fora-do-ar': 'fora do ar',
};
