/**
 * Varredura pela odd DIRETA da casa. Pipeline paralelo ao `src/arb/scanner.ts`.
 *
 * Os dois nao se conhecem: o `src/index.ts` escolhe um pelo setting
 * `fonteDeOdds`. E de proposito — um `if` dentro do scanner atual obrigaria a
 * mexer no arquivo que hoje funciona, e "o modo antigo continua igual" viraria
 * promessa a testar em vez de fato por construcao.
 *
 * O que os dois compartilham e `src/arb/calc.ts`, tambem de proposito: a
 * matematica precisa ser a MESMA para que comparar as duas fontes signifique
 * alguma coisa. Muda a fonte, nao o calculo.
 */

import type { Settings } from '../config.js';
import * as repo from '../db/repo.js';
import { hostsBloqueados } from '../http/client.js';
import type { Jogo } from '../flashscore/feed.js';
import {
  bestLine,
  dedupeKey,
  deveAlertar,
  filtrarOutliers,
  montarAposta,
  type MelhorLinha,
  type OddsCasa,
} from '../arb/calc.js';
// `import type` de proposito: o tipo e compartilhado (o `index.ts` trata os dois
// pipelines como intercambiaveis), mas nao ha import em tempo de execucao — em
// modo `direto` nenhum modulo do Flashscore chega a ser carregado.
import type { Oportunidade, ResultadoVarredura } from '../arb/scanner.js';
import { jogosDaJanela } from './calendario.js';
import { coletarOdds } from './coletor.js';

export interface ResultadoDireto extends ResultadoVarredura {
  casasConsultadas: number;
  casasComFalha: Array<{ nome: string; erro: string }>;
  configsRejeitadas: Array<{ bookmakerId: number; erro: string }>;
  eventosVistos: number;
}

/**
 * A cadencia muda de papel aqui, e vale explicar.
 *
 * No sistema Flashscore ela existe para nao BAIXAR demais: cada jogo custa
 * ~900 KB. No direto o dia inteiro ja veio numa requisicao por casa, entao
 * economizar busca nao economiza nada — o que custa agora e ESCREVER
 * `line_scans` (~112 bytes/linha, e o tier gratuito e finito).
 *
 * Entao a cadencia passa a limitar a gravacao, nunca a avaliacao: todo jogo e
 * avaliado em todo ciclo. Ganho real — um arb que aparecer entre duas janelas
 * de cadencia agora e visto na hora, e nao no proximo intervalo.
 *
 * As faixas repetem as de `intervaloMinutos` do scanner atual (copia, nao
 * import: os dois pipelines nao se importam em tempo de execucao). Repetir 4
 * numeros e o preco dessa independencia; foi o mesmo trato feito com o cliente HTTP.
 */
function minutosEntreGravacoes(minutosAteOInicio: number): number {
  if (minutosAteOInicio > 24 * 60) return 120;
  if (minutosAteOInicio > 6 * 60) return 30;
  if (minutosAteOInicio > 2 * 60) return 10;
  return 2;
}

function deveGravar(jogo: Jogo, ultima: { em: Date; n: number } | undefined, agora: Date): boolean {
  if (!ultima) return true;
  const minutosAteOInicio = (jogo.kickoff.getTime() - agora.getTime()) / 60_000;
  return (
    (agora.getTime() - ultima.em.getTime()) / 60_000 >= minutosEntreGravacoes(minutosAteOInicio)
  );
}

export async function varrerDireto(opcoes: {
  settings: Settings;
  agora?: Date;
}): Promise<ResultadoDireto> {
  const { settings } = opcoes;
  const agora = opcoes.agora ?? new Date();

  const cal = await jogosDaJanela(settings, agora);
  await repo.upsertJogos(cal.jogos);

  const coleta = await coletarOdds(cal.jogos);
  const contas = settings.somenteCasasComConta ? await repo.casasComConta() : null;
  const ultimas = await repo.ultimasVarreduras();

  const oportunidades: Oportunidade[] = [];
  const linhas: Array<{ jogo: Jogo; linha: MelhorLinha }> = [];
  let comOdds = 0;
  let gravados = 0;
  let descartadosPorOutlier = 0;

  for (const jogo of cal.jogos) {
    const todas = coleta.porJogo.get(jogo.id);
    if (!todas || todas.length === 0) continue;

    const comConta: OddsCasa[] = contas
      ? todas.filter((c) => contas.has(c.bookmakerId))
      : todas;

    // Mesmo filtro do outro pipeline. A odd direta e menos sujeita a defasagem,
    // mas nao imune: casa pode deixar preco pendurado no proprio site.
    const filtro = filtrarOutliers(comConta, settings.filtroOutlierPct);
    descartadosPorOutlier += filtro.descartadas.length;
    const elegiveis = filtro.mantidas;

    const linha = bestLine(elegiveis);
    if (!linha) continue;

    comOdds++;
    linhas.push({ jogo, linha });

    if (deveGravar(jogo, ultimas.get(jogo.id), agora)) {
      await repo.gravarLineScan(jogo.id, linha, 'direto');
      await repo.marcarVarredura(jogo.id, (ultimas.get(jogo.id)?.n ?? 0) + 1);
      gravados++;
    }

    const aposta = montarAposta(linha, settings.banca, settings.incrementoStake);
    if (deveAlertar(aposta, settings.lucroMinimoPct)) {
      oportunidades.push({
        jogo,
        linha,
        aposta,
        chave: dedupeKey(jogo.id, aposta.pernas),
        snapshot: elegiveis,
      });
    }
  }

  oportunidades.sort((a, b) => b.aposta.roiPct - a.aposta.roiPct);

  return {
    jogosNoFeed: cal.totalNoFeed,
    aposFiltroDeLiga: cal.daLigaHabilitada,
    aposFiltroPreJogo: cal.jogos.length,
    // Sem teto por ciclo: o custo aqui e por casa, nao por jogo.
    aposCadencia: gravados,
    comOdds,
    oportunidades,
    linhas,
    // Odds cruas por casa: e o que o modo `ambos` compara com o Flashscore.
    oddsPorJogo: coleta.porJogo,
    erros: coleta.casasComFalha.length,
    adiados: 0,
    bloqueado: hostsBloqueados().length > 0,
    descartadosPorOutlier,
    casasConsultadas: coleta.casasConsultadas,
    casasComFalha: coleta.casasComFalha,
    configsRejeitadas: coleta.configsRejeitadas,
    eventosVistos: coleta.eventosVistos,
  };
}
