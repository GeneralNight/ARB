/**
 * Sonda todas as casas cadastradas e diz quais dao para integrar.
 *
 * Converte "27 incognitas" numa lista de trabalho com evidencia. Roda com
 * `fetch` cru de proposito: o objetivo aqui e VER o 403, entao passar pelo
 * cliente com disjuntor seria trabalhar contra o proprio diagnostico.
 *
 * Rode do Brasil. Do exterior o resultado mede geo, nao anti-bot.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import * as repo from '../db/repo.js';
import { UA_PADRAO, comLimite } from '../http/client.js';
import {
  PESO_ACESSO,
  ROTULO_ACESSO,
  classificar,
  type Sondagem,
  type RespostaSondada,
} from '../odds/sondagem.js';

const TIMEOUT_MS = 15_000;
const SAIDA = 'docs/casas-sondagem.md';

/** Headers de navegador de verdade. Nao passam pelo anti-bot — ja testado em
 *  12/08/2026, as quatro casas bloqueadas seguiram em 403 — mas evitam falso
 *  negativo em casa que so queria um Accept-Language decente. */
const HEADERS = {
  'User-Agent': UA_PADRAO,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="139", "Not=A?Brand";v="24", "Google Chrome";v="139"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

interface Linha {
  id: number;
  nome: string;
  url: string;
  cfRay: string | null;
  sondagem: Sondagem;
}

async function sondar(url: string): Promise<{ resposta: RespostaSondada; cfRay: string | null }> {
  try {
    const resp = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      cfRay: resp.headers.get('cf-ray'),
      resposta: {
        status: resp.status,
        cfMitigated: resp.headers.get('cf-mitigated'),
        servidor: resp.headers.get('server'),
        corpo: await resp.text().catch(() => ''),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      cfRay: null,
      resposta: { status: 0, cfMitigated: null, servidor: null, corpo: '', erro: msg },
    };
  }
}

function tabela(linhas: Linha[]): string {
  const cab = '| casa | acesso | plataforma | evidencia |\n|---|---|---|---|';
  const corpo = linhas
    .map(
      (l) =>
        `| [${l.nome}](${l.url}) | ${ROTULO_ACESSO[l.sondagem.acesso]} | ` +
        `${l.sondagem.plataforma ?? '—'} | ${l.sondagem.detalhe} |`,
    )
    .join('\n');
  return `${cab}\n${corpo}`;
}

async function main(): Promise<void> {
  const casas = await repo.casasCadastradas();
  const comUrl = casas.filter((c) => c.url);
  const semUrl = casas.filter((c) => !c.url);

  console.log(`Sondando ${comUrl.length} casas (${semUrl.length} sem URL cadastrada)...\n`);

  const resultados = await comLimite(
    comUrl.map((c) => async (): Promise<Linha> => {
      const { resposta, cfRay } = await sondar(c.url!);
      return { id: c.id, nome: c.nome, url: c.url!, cfRay, sondagem: classificar(resposta) };
    }),
    4,
    200,
  );

  const linhas = resultados.filter((l): l is Linha => l !== null);
  linhas.sort(
    (a, b) =>
      PESO_ACESSO[a.sondagem.acesso] - PESO_ACESSO[b.sondagem.acesso] ||
      a.nome.localeCompare(b.nome),
  );

  for (const l of linhas) {
    const rotulo = ROTULO_ACESSO[l.sondagem.acesso].padEnd(14);
    const plat = l.sondagem.plataforma ? `[${l.sondagem.plataforma}] ` : '';
    console.log(`  ${l.nome.padEnd(16)} ${rotulo} ${plat}${l.sondagem.detalhe}`);
  }

  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const k = ROTULO_ACESSO[l.sondagem.acesso];
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  const resumo = [...contagem.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
  console.log(`\n${resumo}`);

  // A borda do Cloudflare denuncia de onde a requisicao saiu. GRU/GIG = Brasil;
  // qualquer outra coisa e sinal de que a sondagem nao vale para producao.
  const bordas = new Set(linhas.map((l) => l.cfRay?.split('-')[1]).filter(Boolean));
  if (bordas.size > 0) console.log(`bordas Cloudflare: ${[...bordas].join(', ')}`);

  const md = [
    '# Sondagem das casas',
    '',
    `Gerado por \`npm run sondar\` · bordas Cloudflare: ${[...bordas].join(', ') || 'n/d'}`,
    '',
    'Classificacao de **acesso**, nao de qualidade das odds. Ordem = custo de',
    'integracao crescente. Veja `src/odds/sondagem.ts` para o criterio.',
    '',
    tabela(linhas),
    '',
    semUrl.length > 0
      ? `\n## Sem URL cadastrada\n\n${semUrl.map((c) => `- ${c.nome} (id ${c.id})`).join('\n')}\n`
      : '',
  ].join('\n');

  await mkdir('docs', { recursive: true });
  await writeFile(SAIDA, md, 'utf8');
  console.log(`\nRelatorio em ${SAIDA}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
