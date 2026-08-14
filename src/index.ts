/**
 * Loop principal do robo.
 *
 * Roda local de proposito: cada jogo custa ~900 KB de download, o que
 * inviabiliza rodar isso numa funcao de nuvem com cota de banda.
 */

import { anteriorDaFamilia, mereceRealerta } from './arb/calc.js';
import { varrer, type ResultadoVarredura } from './arb/scanner.js';
import { estaBloqueado, segundosAteDesbloquear } from './flashscore/client.js';
import { varrerDireto } from './odds/scanner-direto.js';
import { analisarInversao, compararTudo } from './odds/divergencia.js';
import { coletarOdds } from './odds/coletor.js';
import * as repo from './db/repo.js';
import { enviar, enviarAlerta, processarUpdates, telegramConfigurado } from './telegram/bot.js';
import type { Settings } from './config.js';
import type { OddsCasa } from './arb/calc.js';

const INTERVALO_CICLO_MS = 60_000;
const LIMPEZA_A_CADA_CICLOS = 60; // ~1x por hora

/**
 * De quanto em quanto a sentinela de inversao roda em modo `flashscore`.
 *
 * 30 min e o meio-termo: a inversao anterior passou DOIS DIAS despercebida, e
 * meia hora de exposicao e barata perto de uma coleta direta a cada ciclo. Em
 * modo `ambos` ela roda todo ciclo, porque ali as duas fontes ja estao em maos.
 */
const SENTINELA_A_CADA_CICLOS = 30;

/** Silencio minimo entre dois avisos de inversao no Telegram. */
const SILENCIO_DO_ALARME_MS = 60 * 60_000;

let ultimoAlarmeDeInversao = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const agora = () => new Date().toLocaleTimeString('pt-BR');

let parando = false;
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    console.log('\nEncerrando apos o ciclo atual...');
    parando = true;
  });
}

/**
 * Escolhe o pipeline. E o unico ponto onde os dois sistemas se encontram.
 *
 * Cada um roda em try/catch proprio: em modo `ambos`, o pipeline direto quebrar
 * nao pode impedir o atual de alertar. E NAO ha queda automatica de `direto`
 * para `flashscore` — misturar odd confiavel com odd defasada dentro do mesmo
 * `bestLine` e exatamente o defeito que o sistema direto existe para eliminar.
 */
interface Varredura {
  principal: ResultadoVarredura | null;
  fonte: string;
  /**
   * As duas fontes cruas, quando o ciclo ja as tem em maos.
   *
   * Sao a materia-prima da sentinela de inversao. Devolver aqui e de graca: os
   * bytes ja foram baixados.
   */
  oddsFlashscore?: Map<string, OddsCasa[]>;
  oddsDireto?: Map<string, OddsCasa[]>;
}

async function varredura(settings: Settings): Promise<Varredura> {
  if (settings.fonteDeOdds === 'flashscore') {
    const r = await varrer({ settings });
    return { principal: r, fonte: 'flashscore', oddsFlashscore: r.oddsPorJogo };
  }

  const direto = await varrerDireto({ settings }).catch((err) => {
    console.error(`[${agora()}] pipeline direto falhou:`, err instanceof Error ? err.message : err);
    return null;
  });

  if (direto) {
    for (const c of direto.configsRejeitadas) {
      console.log(`   ! config invalida na casa ${c.bookmakerId}: ${c.erro}`);
    }
    for (const f of direto.casasComFalha) console.log(`   ! ${f.nome}: ${f.erro}`);
  }

  if (settings.fonteDeOdds === 'ambos') {
    // Roda o atual tambem, para nao perder cobertura enquanto poucas casas tem
    // adaptador — e, principalmente, para MEDIR. Quem alerta segue sendo o direto.
    const antigo = await varrer({ settings }).catch(() => null);

    if (antigo && direto) {
      const divs = compararTudo(antigo.oddsPorJogo, direto.oddsPorJogo);
      const gravadas = await repo.gravarDivergencias(divs);
      if (gravadas > 0) {
        const pior = divs.reduce((a, b) => (b.desvioMaxPct > a.desvioMaxPct ? b : a));
        console.log(
          `   divergencia: ${gravadas} casa(s) — pior ${pior.desvioMaxPct.toFixed(1)}% em ${pior.nome}`,
        );
      }
    }

    if (!direto && antigo) {
      return {
        principal: antigo,
        fonte: 'flashscore (direto falhou)',
        oddsFlashscore: antigo.oddsPorJogo,
      };
    }

    return {
      principal: direto,
      fonte: 'direto',
      oddsFlashscore: antigo?.oddsPorJogo,
      oddsDireto: direto?.oddsPorJogo,
    };
  }

  return { principal: direto, fonte: 'direto', oddsDireto: direto?.oddsPorJogo };
}

/**
 * Sentinela: mandante e visitante trocados entre as duas fontes.
 *
 * Existe porque este bug ja aconteceu duas vezes e nao tem sintoma. O ROI
 * continua certo (S e a soma dos tres maximos, e trocar dois rotulos nao muda a
 * soma), os testes continuam verdes (fixture e captura estatica) e o robo segue
 * alertando — so que mandando apostar na perna errada. Em 14/08/2026 viveu dois
 * dias assim.
 *
 * So a segunda fonte enxerga, porque as casas diretas tem rotulo EXPLICITO
 * (`VenueRole` na CT, dupla fonte no Altenar) enquanto o Flashscore so tem
 * ordem de aparicao.
 */
async function conferirInversao(r: ResultadoVarredura, v: Varredura): Promise<void> {
  const fs = v.oddsFlashscore;
  if (!fs || fs.size === 0) return;

  let direto = v.oddsDireto;
  if (!direto) {
    // Em modo `flashscore` a outra fonte nao rodou. Buscar so as odds diretas
    // dos jogos que JA tem odd do Flashscore e barato — o custo do direto e por
    // casa, nao por jogo — e nao grava nada: sentinela mede, nao registra.
    const coleta = await coletarOdds(r.linhas.map((l) => l.jogo));
    direto = coleta.porJogo;
  }

  const veredito = analisarInversao(fs, direto);
  if (veredito.comparadas === 0) return;

  if (!veredito.invertido) {
    console.log(
      `   sentinela: ${veredito.comparadas} perna(s) conferidas, ` +
        `${veredito.espelhadas} espelhada(s) — direcao ok`,
    );
    return;
  }

  const pct = (veredito.fracaoEspelhada * 100).toFixed(1);
  const ex = veredito.exemplos[0];
  console.error(
    `[${agora()}] !!! INVERSAO: ${veredito.espelhadas}/${veredito.comparadas} (${pct}%) ` +
      `pernas espelhadas contra as casas diretas` +
      (ex ? ` — ex.: ${ex.nome} fs ${ex.fs.casa}/${ex.fs.empate}/${ex.fs.fora} vs dir ${ex.dir.casa}/${ex.dir.empate}/${ex.dir.fora}` : ''),
  );

  // Silencio entre avisos: o alarme repetiria a cada sentinela ate alguem
  // consertar, e alarme repetido vira ruido que se aprende a ignorar.
  if (Date.now() - ultimoAlarmeDeInversao < SILENCIO_DO_ALARME_MS) return;
  ultimoAlarmeDeInversao = Date.now();

  if (!telegramConfigurado()) return;
  try {
    await enviar(
      `⚠️ <b>Mandante/visitante possivelmente trocados</b>\n\n` +
        `${veredito.espelhadas} de ${veredito.comparadas} pernas (${pct}%) estao espelhadas ` +
        `entre o Flashscore e as casas diretas: o empate bate e casa/fora trocam.\n\n` +
        `Os alertas seguem com o ROI certo, mas apontando a perna errada. ` +
        `<b>Nao apostar ate conferir.</b>\n\n` +
        `Diagnostico: <code>npm run divergencia</code> · ` +
        `<code>npm run provar:ordem -- &lt;id&gt;</code>`,
    );
  } catch (err) {
    console.error('   falha ao avisar da inversao no Telegram:', err);
  }
}

async function ciclo(n: number): Promise<void> {
  const settings = await repo.lerSettings();

  if (settings.pausado) {
    if (n % 10 === 0) console.log(`[${agora()}] pausado`);
    return;
  }

  // Disjuntor do Flashscore: so trava quem depende dele.
  if (settings.fonteDeOdds !== 'direto' && estaBloqueado()) {
    console.log(`[${agora()}] pausado por rate limit — ${segundosAteDesbloquear()}s restantes`);
    return;
  }

  const v = await varredura(settings);
  const { principal: r, fonte } = v;
  if (!r) return;

  console.log(
    `[${agora()}] [${fonte}] feed ${r.jogosNoFeed} → liga ${r.aposFiltroDeLiga} → ` +
      `pre-jogo ${r.aposFiltroPreJogo} → cadencia ${r.aposCadencia} → ` +
      `odds ${r.comOdds}${r.adiados ? ` (+${r.adiados} adiados)` : ''}` +
      `${r.erros ? ` (${r.erros} erros)` : ''}` +
      // Filtro silencioso e o jeito de o robo emudecer sem ninguem entender.
      `${r.descartadosPorOutlier ? ` · ${r.descartadosPorOutlier} odd(s) fora de mercado` : ''}` +
      `${r.oportunidades.length ? ` · ${r.oportunidades.length} ALERTA(S)` : ''}`,
  );

  if (r.aposFiltroDeLiga === 0 && r.jogosNoFeed > 0) {
    console.log('   nenhum jogo da janela pertence as ligas habilitadas — /janela para ampliar');
  }

  // De graca quando as duas fontes ja rodaram; a cada SENTINELA_A_CADA_CICLOS
  // quando so o Flashscore rodou e a coleta direta precisa ser paga.
  //
  // Nao suprime o alerta quando acusa: o ROI segue correto e a arbitragem pode
  // ser real, entao calar perderia a mensagem que o robo existe para mandar. O
  // aviso diz para conferir antes de apostar — que e o certo com o rotulo sob
  // suspeita, e e o que o usuario ja faz de qualquer forma.
  const temAsDuas = !!v.oddsFlashscore && !!v.oddsDireto;
  if (v.oddsFlashscore && (temAsDuas || n % SENTINELA_A_CADA_CICLOS === 0)) {
    try {
      await conferirInversao(r, v);
    } catch (err) {
      console.error('   sentinela de inversao falhou:', err instanceof Error ? err.message : err);
    }
  }

  for (const op of r.oportunidades) {
    // Um trio ja anunciado so volta a falar se melhorou de verdade — mas volta,
    // porque quase-arb que virou arbitragem e a mensagem que paga o projeto.
    const { melhor, quantos } = anteriorDaFamilia(op.chave, await repo.alertasDoJogo(op.jogo.id));
    if (!mereceRealerta(melhor, op.aposta)) continue;

    const gravado = await repo.gravarAlerta(
      op.jogo.id,
      `${op.chave}@${quantos}`,
      op.aposta,
      settings.banca,
      op.snapshot,
      settings.fonteDeOdds === 'flashscore' ? 'flashscore' : 'direto',
    );
    if (!gravado) continue;

    console.log(
      `   ${op.aposta.isArb ? 'ARB' : 'quase'} ${op.aposta.roiPct.toFixed(2)}% — ` +
        `${op.jogo.mandante} x ${op.jogo.visitante}` +
        (melhor ? ` (melhorou de ${melhor.roiPct.toFixed(2)}%)` : ''),
    );

    if (telegramConfigurado()) {
      try {
        await enviarAlerta(op, gravado.id, melhor?.roiPct);
      } catch (err) {
        console.error('   falha ao enviar no Telegram:', err);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('Robo de arbitragem 1X2 — Flashscore → Supabase → Telegram');

  const settings = await repo.lerSettings();
  const c = await repo.contarCompeticoes();
  console.log(
    `banca ${settings.banca} · limiar ${settings.lucroMinimoPct}%` +
      `${settings.lucroMinimoPct < 0 ? ' (calibracao)' : ''} · ` +
      `janela ${settings.janelaDias === 0 ? 'so hoje' : `+${settings.janelaDias}d`} · ` +
      `${c.habilitadas}/${c.total} ligas habilitadas · ` +
      `fonte ${settings.fonteDeOdds} · ` +
      `telegram ${telegramConfigurado() ? 'ok' : 'nao configurado'}`,
  );
  if (settings.fonteDeOdds !== 'flashscore') {
    const { configs, rejeitadas } = await repo.configsDeCasas();
    console.log(
      `fonte direta: ${configs.length} casa(s) com adaptador` +
        `${rejeitadas.length ? ` · ${rejeitadas.length} config(s) invalida(s)` : ''}`,
    );
  }
  if (c.habilitadas === 0) {
    console.log('\nNenhuma liga habilitada. No painel do Supabase:');
    console.log("  update competitions set enabled = true where id in ('Yq4hUnzQ');");
  }
  console.log('Ctrl+C para parar.\n');

  let n = 0;
  while (!parando) {
    try {
      await ciclo(n);
    } catch (err) {
      console.error(`[${agora()}] erro no ciclo:`, err instanceof Error ? err.message : err);
    }

    if (telegramConfigurado()) await processarUpdates();

    if (n % LIMPEZA_A_CADA_CICLOS === LIMPEZA_A_CADA_CICLOS - 1) {
      try {
        const apagados = await repo.limparScansAntigos();
        if (apagados > 0) console.log(`[${agora()}] retencao: ${apagados} line_scans antigos apagados`);
      } catch (err) {
        console.error('erro na limpeza:', err);
      }
    }

    n++;
    if (!parando) await sleep(INTERVALO_CICLO_MS);
  }

  console.log('Encerrado.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
