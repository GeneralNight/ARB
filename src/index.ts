/**
 * Loop principal do robo.
 *
 * Roda local de proposito: cada jogo custa ~900 KB de download, o que
 * inviabiliza rodar isso numa funcao de nuvem com cota de banda.
 */

import { varrer } from './arb/scanner.js';
import { estaBloqueado, segundosAteDesbloquear } from './flashscore/client.js';
import * as repo from './db/repo.js';
import { enviarAlerta, processarUpdates, telegramConfigurado } from './telegram/bot.js';

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

async function ciclo(n: number): Promise<void> {
  const settings = await repo.lerSettings();

  if (settings.pausado) {
    if (n % 10 === 0) console.log(`[${agora()}] pausado`);
    return;
  }

  // Disjuntor ativo: nem chega a bater no Flashscore.
  if (estaBloqueado()) {
    console.log(`[${agora()}] pausado por rate limit — ${segundosAteDesbloquear()}s restantes`);
    return;
  }

  const r = await varrer({ settings });

  console.log(
    `[${agora()}] feed ${r.jogosNoFeed} → liga ${r.aposFiltroDeLiga} → ` +
      `pre-jogo ${r.aposFiltroPreJogo} → cadencia ${r.aposCadencia} → ` +
      `odds ${r.comOdds}${r.adiados ? ` (+${r.adiados} adiados)` : ''}` +
      `${r.erros ? ` (${r.erros} erros)` : ''}` +
      `${r.oportunidades.length ? ` · ${r.oportunidades.length} ALERTA(S)` : ''}`,
  );

  if (r.aposFiltroDeLiga === 0 && r.jogosNoFeed > 0) {
    console.log('   nenhum jogo da janela pertence as ligas habilitadas — /janela para ampliar');
  }

  for (const op of r.oportunidades) {
    // O UNIQUE em dedupe_key faz o trabalho: alerta repetido nao volta.
    const gravado = await repo.gravarAlerta(
      op.jogo.id,
      op.chave,
      op.aposta,
      settings.banca,
      op.snapshot,
    );
    if (!gravado) continue;

    console.log(
      `   ${op.aposta.isArb ? 'ARB' : 'quase'} ${op.aposta.roiPct.toFixed(2)}% — ` +
        `${op.jogo.mandante} x ${op.jogo.visitante}`,
    );

    if (telegramConfigurado()) {
      try {
        await enviarAlerta(op, gravado.id);
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
      `telegram ${telegramConfigurado() ? 'ok' : 'nao configurado'}`,
  );
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
