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
import * as repo from './db/repo.js';
import { enviarAlerta, processarUpdates, telegramConfigurado } from './telegram/bot.js';
import type { Settings } from './config.js';

const INTERVALO_CICLO_MS = 60_000;
const LIMPEZA_A_CADA_CICLOS = 60; // ~1x por hora

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
async function varredura(
  settings: Settings,
): Promise<{ principal: ResultadoVarredura | null; fonte: string }> {
  if (settings.fonteDeOdds === 'flashscore') {
    return { principal: await varrer({ settings }), fonte: 'flashscore' };
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
    // Roda o atual tambem, so para nao perder cobertura enquanto poucas casas
    // tem adaptador. Quem alerta continua sendo o direto.
    const antigo = await varrer({ settings }).catch(() => null);
    if (!direto && antigo) return { principal: antigo, fonte: 'flashscore (direto falhou)' };
  }

  return { principal: direto, fonte: 'direto' };
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

  const { principal: r, fonte } = await varredura(settings);
  if (!r) return;

  console.log(
    `[${agora()}] [${fonte}] feed ${r.jogosNoFeed} → liga ${r.aposFiltroDeLiga} → ` +
      `pre-jogo ${r.aposFiltroPreJogo} → cadencia ${r.aposCadencia} → ` +
      `odds ${r.comOdds}${r.adiados ? ` (+${r.adiados} adiados)` : ''}` +
      `${r.erros ? ` (${r.erros} erros)` : ''}` +
      `${r.oportunidades.length ? ` · ${r.oportunidades.length} ALERTA(S)` : ''}`,
  );

  if (r.aposFiltroDeLiga === 0 && r.jogosNoFeed > 0) {
    console.log('   nenhum jogo da janela pertence as ligas habilitadas — /janela para ampliar');
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
