/**
 * Envia um alerta de exemplo com os botoes de feedback.
 *
 * Usa um arb sintetico (as odds reais raramente estao em arbitragem no momento
 * do teste) e grava um alerta de verdade no banco, para voce confirmar que o
 * clique no botao chega em arb_alerts.confirmed.
 */

import { bestLine, dedupeKey, montarAposta, type OddsCasa } from '../arb/calc.js';
import * as repo from '../db/repo.js';
import { db } from '../db/client.js';
import { enviarAlerta, processarUpdates, telegramConfigurado } from '../telegram/bot.js';
import type { Jogo } from '../flashscore/feed.js';

const CASAS_EXEMPLO: OddsCasa[] = [
  { bookmakerId: 16, nome: 'bet365', casa: 2.6, empate: 3.0, fora: 3.0 },
  { bookmakerId: 574, nome: 'Betano.br', casa: 2.4, empate: 3.6, fora: 3.0 },
  { bookmakerId: 935, nome: 'Superbet', casa: 2.4, empate: 3.0, fora: 3.4 },
];

const ID_TESTE = '__teste__';

async function main(): Promise<void> {
  if (!telegramConfigurado()) {
    console.error('TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID precisam estar no .env');
    process.exit(1);
  }

  const settings = await repo.lerSettings();
  const linha = bestLine(CASAS_EXEMPLO)!;
  const aposta = montarAposta(linha, settings.banca, settings.incrementoStake);

  const jogo: Jogo = {
    id: ID_TESTE,
    ligaId: '__teste__',
    ligaNome: 'TESTE: mensagem de exemplo',
    mandante: 'Time A',
    visitante: 'Time B',
    kickoff: new Date(Date.now() + 3 * 3600_000),
  };

  // O alerta tem FK para matches, entao o jogo de teste precisa existir.
  await db().from('competitions').upsert({ id: jogo.ligaId, name: jogo.ligaNome }, { onConflict: 'id' });
  await repo.upsertJogos([jogo]);

  const chave = `${dedupeKey(jogo.id, aposta.pernas)}@${Date.now()}`;
  const gravado = await repo.gravarAlerta(jogo.id, chave, aposta, settings.banca, CASAS_EXEMPLO);
  if (!gravado) throw new Error('nao consegui gravar o alerta de teste');

  await enviarAlerta({ jogo, linha, aposta, chave, snapshot: CASAS_EXEMPLO }, gravado.id);

  console.log(`Alerta enviado (arb_alerts.id = ${gravado.id}) · ROI ${aposta.roiPct.toFixed(2)}%`);
  console.log('\nClique num dos botoes no Telegram. Aguardando ate 90s...');

  // O Telegram expira o callback em ~15s, entao e preciso estar lendo a fila
  // quando o clique acontece — senao o botao fica girando.
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    await processarUpdates();

    const { data } = await db()
      .from('arb_alerts')
      .select('confirmed')
      .eq('id', gravado.id)
      .single();

    if (data?.confirmed !== null && data?.confirmed !== undefined) {
      console.log(
        `\n✓ Feedback registrado: confirmed = ${data.confirmed} ` +
          `(${data.confirmed ? 'a odd existia' : 'a odd ja tinha sumido'})`,
      );
      console.log(`\nPara limpar:  delete from matches where id = '${ID_TESTE}';`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\nNao chegou clique em 90s.');
  console.log('Se voce clicou depois, rode de novo ou deixe o npm start rodando:');
  console.log(`  select id, confirmed from arb_alerts where id = ${gravado.id};`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
