/**
 * "Quanto eu teria feito se tivesse apostado em tudo?"
 *
 * A resposta honesta tem camadas, e a diferenca entre elas e enorme. Este CLI
 * mostra a escada inteira em vez de um numero solto, porque o numero solto
 * (somar `profit`) e ficcao por tres motivos independentes:
 *
 *  1. `arb_alerts` tem uma linha por MENSAGEM, nao por oportunidade. O mesmo
 *     trio realertado tres vezes vira tres linhas — e uma chance so.
 *  2. Um terco dos alertas foi montado sobre odd fora de mercado, que
 *     provavelmente nem existia na casa.
 *  3. Cada arbitragem imobiliza a banca inteira. Apostar em N oportunidades
 *     simultaneas exigiria N vezes a banca, nao uma.
 *
 * E o que nenhuma conta resolve: so 1 de 95 alertas tem confirmacao de que a
 * odd ainda estava la. Sem isso, tudo aqui e teto, nunca estimativa.
 */

import { bestLine, filtrarOutliers, montarAposta, type OddsCasa } from '../arb/calc.js';
import * as repo from '../db/repo.js';
import { db } from '../db/client.js';

const real = (n: number) => `R$ ${n.toFixed(2)}`;

async function main(): Promise<void> {
  const limiar = Number(process.argv[2] ?? 25);
  const settings = await repo.lerSettings();

  const { data, error } = await db()
    .from('arb_alerts')
    .select('id, match_id, dedupe_key, detected_at, roi_pct, profit, bankroll, full_snapshot, confirmed')
    .order('detected_at', { ascending: true });
  if (error) throw new Error(error.message);
  const alertas = data ?? [];

  // --- camada 1: somar tudo
  const bruto = alertas.reduce((soma, a) => soma + Number(a.profit ?? 0), 0);

  // --- camada 2: uma linha por oportunidade (familia), a melhor de cada
  const porFamilia = new Map<string, (typeof alertas)[number]>();
  for (const a of alertas) {
    const familia = String(a.dedupe_key).split('@')[0]!;
    const atual = porFamilia.get(familia);
    if (!atual || Number(a.profit ?? 0) > Number(atual.profit ?? 0)) porFamilia.set(familia, a);
  }
  const familias = [...porFamilia.values()];
  const porOportunidade = familias.reduce((s, a) => s + Number(a.profit ?? 0), 0);

  // --- camada 3: so as que sobrevivem ao filtro de odd fora de mercado
  let sobreviventes = 0;
  let lucroFiltrado = 0;
  let semSnapshot = 0;
  for (const a of familias) {
    const snap = a.full_snapshot as OddsCasa[] | null;
    if (!Array.isArray(snap) || snap.length === 0) {
      semSnapshot++;
      continue;
    }
    const linha = bestLine(filtrarOutliers(snap, limiar).mantidas);
    if (!linha) continue;
    const aposta = montarAposta(linha, Number(a.bankroll ?? settings.banca), settings.incrementoStake);
    if (aposta.lucroPiorCaso > 0) {
      sobreviventes++;
      lucroFiltrado += aposta.lucroPiorCaso;
    }
  }

  // --- restricao de banca: quantas oportunidades coexistiam no tempo
  const porDia = new Map<string, number>();
  for (const a of familias) {
    const dia = String(a.detected_at).slice(0, 10);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  const maxPorDia = Math.max(0, ...porDia.values());

  const confirmados = alertas.filter((a) => a.confirmed === true).length;
  const negados = alertas.filter((a) => a.confirmed === false).length;

  console.log(`Banca de referencia: ${real(settings.banca)} · limiar de outlier ${limiar}%\n`);

  console.log('  1. somando todas as mensagens de alerta');
  console.log(`     ${alertas.length} linhas  ->  ${real(bruto)}`);
  console.log('     FICCAO: conta o mesmo trio varias vezes.\n');

  console.log('  2. uma vez por oportunidade (familia de alerta)');
  console.log(`     ${familias.length} oportunidades  ->  ${real(porOportunidade)}`);
  console.log(`     -${real(bruto - porOportunidade)} so por parar de contar repetido.\n`);

  console.log('  3. descartando as montadas sobre odd fora de mercado');
  console.log(`     ${sobreviventes} oportunidades  ->  ${real(lucroFiltrado)}`);
  console.log(
    `     -${real(porOportunidade - lucroFiltrado)} de arbitragem que provavelmente nao existia.` +
      (semSnapshot ? `  (${semSnapshot} sem snapshot, fora da conta)` : ''),
  );

  console.log('\n  4. e o que a conta NAO cobre:');
  console.log(
    `     · banca: ate ${maxPorDia} oportunidades no mesmo dia. Apostar em todas exigiria` +
      ` ~${real(settings.banca * maxPorDia)}, nao ${real(settings.banca)}.`,
  );
  console.log('     · a odd ainda estava la quando voce fosse apostar?');
  console.log(
    `       ${confirmados} confirmado(s), ${negados} negado(s), ` +
      `${alertas.length - confirmados - negados} sem resposta.`,
  );
  console.log('     · stake maximo da casa, e limitacao de conta em quem arbitra.');

  const mediaPorOp = sobreviventes > 0 ? lucroFiltrado / sobreviventes : 0;
  console.log(
    `\nTeto defensavel: ${real(lucroFiltrado)} em ${sobreviventes} oportunidades ` +
      `(media de ${real(mediaPorOp)} cada, ${((mediaPorOp / settings.banca) * 100).toFixed(2)}% da banca).`,
  );
  console.log('Teto, nao estimativa: assume execucao perfeita nas tres pernas, em todas.');

  // O unico dado empirico sobre execucao que existe. Amostra minuscula, mas e o
  // que ha — e a direcao dela e forte demais para ser omitida do resultado.
  const respostas = confirmados + negados;
  if (respostas > 0) {
    const taxa = confirmados / respostas;
    console.log(
      `\nAjustando pela taxa de confirmacao medida (${confirmados}/${respostas} = ` +
        `${(taxa * 100).toFixed(0)}%):  ~${real(lucroFiltrado * taxa)}`,
    );
    console.log(
      `AMOSTRA DE ${respostas}. Nao e estimativa confiavel — e o unico dado empirico que existe` +
        ' sobre execucao, e ele aponta para baixo.',
    );
    if (taxa < 0.5) {
      console.log(
        'E ha pior: perna orfa. Fechar 2 de 3 apostas e a 3a odd sumir deixa exposto,',
      );
      console.log('entao tentativa frustrada nao custa zero — pode custar negativo.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
