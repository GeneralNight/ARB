/**
 * Bot do Telegram: alertas + feedback + comandos de operacao.
 *
 * A curadoria de ligas e casas e feita no painel do Supabase; aqui ficam so
 * os ajustes que voce quer mudar com o celular na mao.
 *
 * Os botoes de feedback sao a peca mais importante do projeto: eles medem
 * quanto as odds do Flashscore atrasam em relacao as casas de verdade.
 */

import { JANELA_DIAS_MAX, carregarEnv } from '../config.js';
import * as repo from '../db/repo.js';
import { matchUrl } from '../flashscore/endpoints.js';
import type { Oportunidade } from '../arb/scanner.js';

const API = 'https://api.telegram.org/bot';

interface BotaoInline {
  text: string;
  callback_data: string;
}

function token(): string {
  const t = carregarEnv().TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN ausente no .env');
  return t;
}

function chatId(): string {
  const c = carregarEnv().TELEGRAM_CHAT_ID;
  if (!c) throw new Error('TELEGRAM_CHAT_ID ausente no .env');
  return c;
}

export function telegramConfigurado(): boolean {
  const env = carregarEnv();
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

async function chamar<T = unknown>(metodo: string, corpo: unknown): Promise<T> {
  const resp = await fetch(`${API}${token()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await resp.json()) as { ok: boolean; description?: string; result?: T };
  if (!json.ok) throw new Error(`Telegram ${metodo}: ${json.description ?? 'erro desconhecido'}`);
  return json.result as T;
}

export async function enviar(texto: string, botoes?: BotaoInline[][]): Promise<number> {
  const msg = await chamar<{ message_id: number }>('sendMessage', {
    chat_id: chatId(),
    text: texto,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(botoes ? { reply_markup: { inline_keyboard: botoes } } : {}),
  });
  return msg.message_id;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hora = (d: Date) =>
  d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ROTULO = { casa: 'Casa', empate: 'Empate', fora: 'Fora' } as const;

export function formatarAlerta(op: Oportunidade): string {
  const { jogo, aposta, linha } = op;
  const arb = aposta.isArb;

  const cabecalho = arb
    ? `🟢 <b>ARBITRAGEM ${aposta.roiPct.toFixed(2)}%</b>`
    : `🟡 <b>Quase-arb ${aposta.roiPct.toFixed(2)}%</b> (calibracao)`;

  const pernas = aposta.pernas
    .map(
      (p) =>
        `${ROTULO[p.resultado].padEnd(6)} <b>${escapar(p.nome)}</b> @${p.odd.toFixed(2)}\n` +
        `        apostar <b>${brl(p.stake)}</b> → retorno ${brl(p.retorno)}`,
    )
    .join('\n');

  const desfecho = arb
    ? `Lucro garantido: <b>${brl(aposta.lucroPiorCaso)}</b> em qualquer resultado`
    : `Resultado no pior caso: <b>${brl(aposta.lucroPiorCaso)}</b> — ainda nao compensa`;

  return [
    cabecalho,
    '',
    `<b>${escapar(jogo.mandante)} × ${escapar(jogo.visitante)}</b>`,
    `${escapar(jogo.ligaNome)} · ${hora(jogo.kickoff)}`,
    '',
    pernas,
    '',
    `Total: ${brl(aposta.total)} · S = ${linha.s.toFixed(5)} · ${linha.bookCount} casas`,
    desfecho,
    '',
    `<a href="${matchUrl(jogo.id)}">Ver no Flashscore</a>`,
    '',
    '⚠️ <i>As odds do Flashscore chegam com atraso. Confira na casa antes de apostar.</i>',
  ].join('\n');
}

export async function enviarAlerta(op: Oportunidade, alertaId: number): Promise<void> {
  await enviar(formatarAlerta(op), [
    [
      { text: '✅ Odd estava la', callback_data: `ok:${alertaId}` },
      { text: '❌ Ja tinha sumido', callback_data: `no:${alertaId}` },
    ],
  ]);
  await repo.marcarNotificado(alertaId);
}

// ------------------------------------------------------- polling de comandos

interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

let ultimoUpdate = 0;

/**
 * Le comandos e cliques de botao desde a ultima chamada.
 * Chamado entre ciclos de varredura — nao precisa de webhook nem servidor.
 */
export async function processarUpdates(): Promise<void> {
  let updates: Update[];
  try {
    updates = await chamar<Update[]>('getUpdates', {
      offset: ultimoUpdate + 1,
      timeout: 0,
      allowed_updates: ['message', 'callback_query'],
    });
  } catch {
    return; // rede instavel nao pode derrubar o robo
  }

  for (const u of updates) {
    ultimoUpdate = Math.max(ultimoUpdate, u.update_id);
    try {
      if (u.callback_query) await tratarBotao(u.callback_query);
      else if (u.message?.text) await tratarComando(u.message.text.trim());
    } catch (err) {
      console.error('[telegram] erro tratando update:', err);
    }
  }
}

/**
 * answerCallbackQuery so serve para parar o "rodinha" do botao, e o Telegram
 * expira a query em ~15s. Se o robo estava parado quando voce clicou, ela ja
 * venceu — mas isso e cosmetico e NAO pode impedir o resto do tratamento.
 */
async function pararRodinha(callbackId: string, texto?: string): Promise<void> {
  try {
    await chamar('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(texto ? { text: texto } : {}),
    });
  } catch {
    // "query is too old": o clique foi antes de o robo ler a fila. Sem problema.
  }
}

async function tratarBotao(cb: NonNullable<Update['callback_query']>): Promise<void> {
  const [acao, id] = (cb.data ?? '').split(':');
  const alertaId = Number(id);

  if ((acao !== 'ok' && acao !== 'no') || !Number.isFinite(alertaId)) {
    await pararRodinha(cb.id);
    return;
  }

  const confirmado = acao === 'ok';

  // O que importa e o registro: e feito primeiro e sozinho.
  await repo.registrarConfirmacao(alertaId, confirmado);

  await pararRodinha(
    cb.id,
    confirmado ? 'Registrado: a odd existia.' : 'Registrado: a odd ja tinha sumido.',
  );

  // Trocar os botoes por uma marca e o feedback visual que voce enxerga —
  // acontece mesmo quando a query ja expirou.
  if (!cb.message) return;
  try {
    await chamar('editMessageReplyMarkup', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: confirmado ? '✅ confirmado' : '❌ odd sumiu', callback_data: 'noop' }]],
      },
    });
  } catch {
    // Mensagem antiga demais para editar. O registro no banco ja esta feito.
  }
}

const AJUDA = [
  '<b>Comandos</b>',
  '/status — configuracao atual',
  '/resumo — desempenho dos ultimos dias',
  '/banca 2000 — total a distribuir entre as 3 apostas',
  '/min 1.5 — so alerta a partir de 1,5% de lucro (aceita negativo)',
  '/janela 2 — quantos dias a frente varrer (0 = so hoje, max 7)',
  '/pausar · /retomar',
  '',
  '<i>Ligas e casas sao gerenciadas no painel do Supabase.</i>',
].join('\n');

function descreverJanela(dias: number): string {
  if (dias === 0) return 'so hoje';
  if (dias === 1) return 'hoje + amanha';
  return `hoje + ${dias} dias`;
}

async function tratarComando(texto: string): Promise<void> {
  const [cmd, arg] = texto.split(/\s+/);

  switch (cmd) {
    case '/start':
    case '/ajuda':
    case '/help':
      await enviar(AJUDA);
      return;

    case '/status': {
      const s = await repo.lerSettings();
      const c = await repo.contarCompeticoes();
      await enviar(
        [
          '<b>Status</b>',
          `Banca: ${brl(s.banca)}`,
          `Limiar: ${s.lucroMinimoPct}%${s.lucroMinimoPct < 0 ? ' (modo calibracao)' : ''}`,
          `Incremento do stake: ${brl(s.incrementoStake)}`,
          `So casas com conta: ${s.somenteCasasComConta ? 'sim' : 'nao'}`,
          `Janela: ${descreverJanela(s.janelaDias)}`,
          `Para de varrer: ${s.minutosAntesDoInicio} min antes do apito`,
          `Ligas: ${c.habilitadas} habilitadas de ${c.total}`,
          s.pausado ? '\n⏸ <b>PAUSADO</b>' : '',
        ].join('\n'),
      );
      return;
    }

    case '/resumo': {
      const linhas = await repo.resumoAlertas();
      if (linhas.length === 0) {
        await enviar('Ainda sem alertas registrados.');
        return;
      }
      const corpo = linhas
        .map(
          (l) =>
            `<b>${l.dia}</b> — ${l.alertas} alertas · ROI medio ${l.roi_medio}% · max ${l.roi_max}%\n` +
            `    odd existia: ${l.ainda_existiam} · ja sumira: ${l.ja_tinham_sumido}`,
        )
        .join('\n');
      await enviar(`<b>Ultimos dias</b>\n${corpo}`);
      return;
    }

    case '/banca': {
      const v = Number(arg?.replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) {
        await enviar('Uso: /banca 2000');
        return;
      }
      await repo.gravarSetting('banca', v);
      await enviar(`Banca agora e ${brl(v)}.`);
      return;
    }

    case '/min': {
      const v = Number(arg?.replace(',', '.'));
      if (!Number.isFinite(v)) {
        await enviar('Uso: /min 1.5 (aceita negativo para ver quase-arbs)');
        return;
      }
      await repo.gravarSetting('lucroMinimoPct', v);
      await enviar(
        v < 0
          ? `Limiar em ${v}% — modo calibracao: voce vera tambem quase-arbs.`
          : `Limiar em ${v}% — so alerta arbitragem real acima disso.`,
      );
      return;
    }

    case '/janela': {
      const v = Number(arg);
      if (!Number.isInteger(v) || v < 0 || v > JANELA_DIAS_MAX) {
        await enviar(
          `Uso: /janela 2\n\n0 = so hoje · 1 = hoje + amanha · maximo ${JANELA_DIAS_MAX}.\n` +
            '<i>O feed do Flashscore nao vai alem de 7 dias.</i>',
        );
        return;
      }
      await repo.gravarSetting('janelaDias', v);
      await enviar(
        `Janela agora e <b>${descreverJanela(v)}</b>.` +
          (v > 2
            ? '\n\n<i>Janela larga aumenta o download. Jogos a mais de 24h sao ' +
              'revarridos so a cada 2h, entao o custo cresce menos que o numero de dias.</i>'
            : ''),
      );
      return;
    }

    case '/pausar':
      await repo.gravarSetting('pausado', true);
      await enviar('⏸ Pausado. /retomar para voltar.');
      return;

    case '/retomar':
      await repo.gravarSetting('pausado', false);
      await enviar('▶️ Retomado.');
      return;

    default:
      if (cmd?.startsWith('/')) await enviar(AJUDA);
  }
}
