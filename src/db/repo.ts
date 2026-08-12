/**
 * Acesso ao Supabase. Todas as escritas do robo passam por aqui.
 *
 * Regra de ouro deste arquivo: as colunas curadas por voce
 * (`competitions.enabled`, `bookmakers.has_account`, `bookmakers.max_stake`,
 * `bookmakers.url`) NUNCA sao tocadas por upsert automatico.
 */

import { RETENCAO_DIAS, SETTINGS_PADRAO, settingsSchema, type Settings } from '../config.js';
import type { AlertaAnterior, Aposta, MelhorLinha } from '../arb/calc.js';
import type { Jogo, Liga } from '../flashscore/feed.js';
import { validarConfig, type ConfigCasa } from '../odds/esquema.js';
import { db } from './client.js';

// ---------------------------------------------------------------- settings

export async function lerSettings(): Promise<Settings> {
  const { data, error } = await db().from('settings').select('key, value');
  if (error) throw new Error(`lendo settings: ${error.message}`);

  const bruto: Record<string, unknown> = { ...SETTINGS_PADRAO };
  for (const linha of data ?? []) bruto[linha.key] = linha.value;

  const r = settingsSchema.safeParse(bruto);
  if (!r.success) {
    throw new Error(
      `settings invalidos no banco: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  return r.data;
}

export async function gravarSetting(key: keyof Settings, value: unknown): Promise<void> {
  const { error } = await db()
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`gravando setting ${key}: ${error.message}`);
}

// ------------------------------------------------- contrato de curadoria

/**
 * Colunas que so voce edita. Nenhum upsert automatico pode escreve-las.
 *
 * Existem como dado, e nao so como comentario, porque ha teste de regressao
 * comparando as chaves montadas abaixo contra estas listas: o jeito de apagar
 * sua curadoria em silencio e alguem acrescentar um campo ao upsert sem pensar,
 * e comentario nenhum impede isso.
 */
export const COLUNAS_CURADAS = {
  competitions: ['enabled'],
  bookmakers: ['has_account', 'max_stake', 'note', 'url'],
  bookmaker_competitions: ['manual'],
  bookmaker_events: ['manual'],
} as const;

/** Exatamente o que o sync tem permissao de escrever. */
export const COLUNAS_DO_SYNC = {
  competitions: ['id', 'name', 'url_path', 'country', 'last_seen_at'],
  bookmakers: ['id', 'name', 'last_seen_at'],
  bookmaker_competitions: ['bookmaker_id', 'competition_id', 'competition_id_casa', 'score'],
  bookmaker_events: ['bookmaker_id', 'match_id', 'event_id_casa', 'score', 'via'],
} as const;

/**
 * Tabelas que sao inteiramente do usuario/painel — o robo so LE.
 *
 * Diferente das acima, onde o sync escreve algumas colunas: aqui nao ha upsert
 * automatico nenhum. Estao listadas para que o teste de regressao possa cobrar.
 */
export const TABELAS_SO_LEITURA = ['bookmaker_configs', 'bookmaker_auth'] as const;

// ------------------------------------------------------------ competicoes

/**
 * Linhas do upsert de competicoes. Pura de proposito: e o que o teste inspeciona.
 *
 * `enabled` fica deliberadamente de fora — um sync que a sobrescrevesse
 * apagaria a configuracao inteira sem aviso.
 */
export function linhasDeCompeticoes(ligas: Liga[], agora = new Date()) {
  return ligas.map((l) => ({
    id: l.id,
    name: l.nome,
    url_path: l.urlPath,
    country: l.pais,
    last_seen_at: agora.toISOString(),
  }));
}

/** Insere competicoes novas e atualiza nome/last_seen das existentes. */
export async function upsertCompeticoes(ligas: Liga[]): Promise<void> {
  if (ligas.length === 0) return;
  const { error } = await db()
    .from('competitions')
    .upsert(linhasDeCompeticoes(ligas), { onConflict: 'id', ignoreDuplicates: false });
  if (error) throw new Error(`upsert de competicoes: ${error.message}`);
}

export async function ligasHabilitadas(): Promise<Set<string>> {
  const { data, error } = await db().from('competitions').select('id').eq('enabled', true);
  if (error) throw new Error(`lendo ligas habilitadas: ${error.message}`);
  return new Set((data ?? []).map((l) => l.id as string));
}

export async function contarCompeticoes(): Promise<{ total: number; habilitadas: number }> {
  const total = await db().from('competitions').select('*', { count: 'exact', head: true });
  const hab = await db()
    .from('competitions')
    .select('*', { count: 'exact', head: true })
    .eq('enabled', true);
  return { total: total.count ?? 0, habilitadas: hab.count ?? 0 };
}

// --------------------------------------------------------------- casas

/**
 * Linhas do upsert de casas. Pura de proposito: e o que o teste inspeciona.
 *
 * Mesma logica do upsert de ligas: `has_account`, `max_stake`, `note` e `url`
 * sao seus e ficam de fora.
 */
export function linhasDeCasas(casas: Array<{ id: number; nome: string }>, agora = new Date()) {
  return casas.map((c) => ({
    id: c.id,
    name: c.nome,
    last_seen_at: agora.toISOString(),
  }));
}

export async function upsertCasas(casas: Array<{ id: number; nome: string }>): Promise<void> {
  if (casas.length === 0) return;
  const { error } = await db().from('bookmakers').upsert(linhasDeCasas(casas), { onConflict: 'id' });
  if (error) throw new Error(`upsert de casas: ${error.message}`);
}

/**
 * id da casa -> link, para o alerta virar clicavel no celular.
 *
 * Coluna curada por voce: o Flashscore nao manda URL nenhuma. Casa sem link
 * cadastrado simplesmente aparece como texto.
 */
export async function urlsDasCasas(): Promise<Map<number, string>> {
  const { data, error } = await db().from('bookmakers').select('id, url').not('url', 'is', null);
  if (error) throw new Error(`lendo urls das casas: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id as number, c.url as string]));
}

export async function casasComConta(): Promise<Set<number>> {
  const { data, error } = await db().from('bookmakers').select('id').eq('has_account', true);
  if (error) throw new Error(`lendo casas com conta: ${error.message}`);
  return new Set((data ?? []).map((c) => c.id as number));
}

export interface CasaCadastrada {
  id: number;
  nome: string;
  url: string | null;
}

/** Catalogo completo de casas — usado pela sondagem e pelo registro de configs. */
export async function casasCadastradas(): Promise<CasaCadastrada[]> {
  const { data, error } = await db().from('bookmakers').select('id, name, url').order('name');
  if (error) throw new Error(`lendo casas: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id as number,
    nome: c.name as string,
    url: (c.url as string | null) ?? null,
  }));
}

// ------------------------------------------- casas: config e pareamento

/**
 * Linhas do upsert de pareamento de competicoes. Pura: e o que o teste inspeciona.
 *
 * `manual` fica de fora pelo mesmo motivo que `enabled` fica fora do sync de
 * ligas — o usuario corrige o que a heuristica errou, e um sync que
 * sobrescrevesse a correcao a desfaria em silencio a cada execucao.
 */
export function linhasDePareamentoDeCompeticoes(
  pares: Array<{ bookmakerId: number; competitionId: string; competitionIdCasa: string; score: number }>,
) {
  return pares.map((p) => ({
    bookmaker_id: p.bookmakerId,
    competition_id: p.competitionId,
    competition_id_casa: p.competitionIdCasa,
    score: p.score,
  }));
}

/** Grava pareamentos de liga, preservando as linhas marcadas como manuais. */
export async function upsertPareamentoDeCompeticoes(
  pares: Array<{ bookmakerId: number; competitionId: string; competitionIdCasa: string; score: number }>,
): Promise<number> {
  if (pares.length === 0) return 0;

  const manuais = await pareamentosManuaisDeCompeticoes();
  const gravaveis = pares.filter((p) => !manuais.has(`${p.bookmakerId}:${p.competitionId}`));
  if (gravaveis.length === 0) return 0;

  const { error } = await db()
    .from('bookmaker_competitions')
    .upsert(linhasDePareamentoDeCompeticoes(gravaveis), {
      onConflict: 'bookmaker_id,competition_id',
    });
  if (error) throw new Error(`upsert de pareamento de competicoes: ${error.message}`);
  return gravaveis.length;
}

async function pareamentosManuaisDeCompeticoes(): Promise<Set<string>> {
  const { data, error } = await db()
    .from('bookmaker_competitions')
    .select('bookmaker_id, competition_id')
    .eq('manual', true);
  if (error) throw new Error(`lendo pareamentos manuais: ${error.message}`);
  return new Set((data ?? []).map((l) => `${l.bookmaker_id}:${l.competition_id}`));
}

/** id do Flashscore -> id do campeonato na casa, para uma casa. */
export async function competicoesDaCasa(bookmakerId: number): Promise<Map<string, string>> {
  const { data, error } = await db()
    .from('bookmaker_competitions')
    .select('competition_id, competition_id_casa')
    .eq('bookmaker_id', bookmakerId);
  if (error) throw new Error(`lendo competicoes da casa ${bookmakerId}: ${error.message}`);
  return new Map((data ?? []).map((l) => [l.competition_id as string, l.competition_id_casa as string]));
}

export function linhasDePareamentoDeEventos(
  pares: Array<{ bookmakerId: number; matchId: string; eventIdCasa: string; score: number; via: string }>,
) {
  return pares.map((p) => ({
    bookmaker_id: p.bookmakerId,
    match_id: p.matchId,
    event_id_casa: p.eventIdCasa,
    score: p.score,
    via: p.via,
  }));
}

export async function upsertPareamentoDeEventos(
  pares: Array<{ bookmakerId: number; matchId: string; eventIdCasa: string; score: number; via: string }>,
): Promise<void> {
  if (pares.length === 0) return;
  const { error } = await db()
    .from('bookmaker_events')
    .upsert(linhasDePareamentoDeEventos(pares), { onConflict: 'bookmaker_id,match_id' });
  if (error) throw new Error(`upsert de pareamento de eventos: ${error.message}`);
}

/**
 * Configs das casas, ja validadas.
 *
 * A validacao acontece aqui, na leitura, e config invalida vira log + descarte
 * daquela casa. O painel escreve direto no banco: sem esta barreira, um campo
 * digitado errado no navegador pararia a varredura inteira.
 */
export async function configsDeCasas(): Promise<{ configs: ConfigCasa[]; rejeitadas: Array<{ bookmakerId: number; erro: string }> }> {
  const { data, error } = await db()
    .from('bookmaker_configs')
    .select('bookmaker_id, config')
    .eq('enabled', true);
  if (error) throw new Error(`lendo configs de casas: ${error.message}`);

  const configs: ConfigCasa[] = [];
  const rejeitadas: Array<{ bookmakerId: number; erro: string }> = [];
  for (const linha of data ?? []) {
    const r = validarConfig(linha.config);
    if (r.ok) configs.push(r.config);
    else rejeitadas.push({ bookmakerId: linha.bookmaker_id as number, erro: r.erro });
  }
  return { configs, rejeitadas };
}

export async function salvarConfigDeCasa(bookmakerId: number, config: unknown): Promise<void> {
  const { error } = await db()
    .from('bookmaker_configs')
    .upsert(
      { bookmaker_id: bookmakerId, config, updated_at: new Date().toISOString() },
      { onConflict: 'bookmaker_id' },
    );
  if (error) throw new Error(`gravando config da casa ${bookmakerId}: ${error.message}`);
}

/** Cookie + UA colhidos pelo porteiro. Andam juntos: o cf_clearance depende do UA. */
export async function authDaCasa(
  bookmakerId: number,
): Promise<{ cookie: string; userAgent: string | null } | null> {
  const { data, error } = await db()
    .from('bookmaker_auth')
    .select('cookie, user_agent')
    .eq('bookmaker_id', bookmakerId)
    .maybeSingle();
  if (error) throw new Error(`lendo auth da casa ${bookmakerId}: ${error.message}`);
  if (!data?.cookie) return null;
  return { cookie: data.cookie as string, userAgent: (data.user_agent as string | null) ?? null };
}

// --------------------------------------------------------------- jogos

export async function upsertJogos(jogos: Jogo[]): Promise<void> {
  if (jogos.length === 0) return;
  const linhas = jogos.map((j) => ({
    id: j.id,
    competition_id: j.ligaId,
    home: j.mandante,
    away: j.visitante,
    kickoff: j.kickoff.toISOString(),
  }));
  const { error } = await db().from('matches').upsert(linhas, { onConflict: 'id' });
  if (error) throw new Error(`upsert de jogos: ${error.message}`);
}

export async function marcarVarredura(matchId: string, scanCount: number): Promise<void> {
  const { error } = await db()
    .from('matches')
    .update({ last_scan_at: new Date().toISOString(), scan_count: scanCount })
    .eq('id', matchId);
  if (error) throw new Error(`marcando varredura: ${error.message}`);
}

export async function ultimasVarreduras(): Promise<Map<string, { em: Date; n: number }>> {
  const { data, error } = await db().from('matches').select('id, last_scan_at, scan_count');
  if (error) throw new Error(`lendo ultimas varreduras: ${error.message}`);
  const mapa = new Map<string, { em: Date; n: number }>();
  for (const l of data ?? []) {
    if (l.last_scan_at) mapa.set(l.id as string, { em: new Date(l.last_scan_at), n: l.scan_count ?? 0 });
  }
  return mapa;
}

// ------------------------------------------------------------ line_scans

/**
 * `source` diz de qual sistema veio a leitura.
 *
 * Sem isso o historico vira mistura nao interpretavel: o baseline empirico do
 * projeto foi medido com odds do Flashscore, e comparar com odds diretas sem
 * saber qual e qual nao significa nada. Padrao 'flashscore' para que a chamada
 * do sistema atual continue identica.
 */
export async function gravarLineScan(
  matchId: string,
  linha: MelhorLinha,
  source: 'flashscore' | 'direto' = 'flashscore',
): Promise<void> {
  const { error } = await db().from('line_scans').insert({
    match_id: matchId,
    source,
    s: linha.s.toFixed(5),
    margin_pct: linha.margemPct.toFixed(3),
    best_home: linha.casa.odd,
    best_home_book: linha.casa.bookmakerId,
    best_draw: linha.empate.odd,
    best_draw_book: linha.empate.bookmakerId,
    best_away: linha.fora.odd,
    best_away_book: linha.fora.bookmakerId,
    book_count: linha.bookCount,
  });
  if (error) throw new Error(`gravando line_scan: ${error.message}`);
}

/** Mantem o banco dentro dos 500 MB do tier gratuito. arb_alerts nunca some. */
export async function limparScansAntigos(): Promise<number> {
  const corte = new Date(Date.now() - RETENCAO_DIAS * 86_400_000).toISOString();
  const { data, error } = await db().from('line_scans').delete().lt('scanned_at', corte).select('id');
  if (error) throw new Error(`limpando line_scans: ${error.message}`);
  return data?.length ?? 0;
}

// ------------------------------------------------------------ arb_alerts

export interface AlertaGravado {
  id: number;
  novo: boolean;
}

/**
 * Grava o alerta. `dedupeKey` aqui e `familia@n` — uma linha por mensagem
 * enviada, para que cada uma tenha seu proprio botao de feedback.
 *
 * O UNIQUE continua sendo a rede de seguranca contra a mesma mensagem sair
 * duas vezes (reinicio no meio do ciclo, por exemplo). Quem decide se o trio
 * merece falar de novo e `mereceRealerta`, antes de chegar aqui.
 */
export async function gravarAlerta(
  matchId: string,
  dedupeKey: string,
  aposta: Aposta,
  banca: number,
  snapshot: unknown,
  source: 'flashscore' | 'direto' = 'flashscore',
): Promise<AlertaGravado | null> {
  const { data, error } = await db()
    .from('arb_alerts')
    .upsert(
      {
        match_id: matchId,
        dedupe_key: dedupeKey,
        source,
        s: aposta.s.toFixed(5),
        roi_pct: aposta.roiPct.toFixed(3),
        bankroll: banca,
        legs: aposta.pernas,
        profit: aposta.lucroPiorCaso,
        full_snapshot: snapshot,
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw new Error(`gravando alerta: ${error.message}`);
  const linha = data?.[0];
  return linha ? { id: linha.id as number, novo: true } : null;
}

/**
 * Alertas ja emitidos para este jogo, para decidir se o trio atual e novidade.
 *
 * Le o jogo inteiro em vez de filtrar a familia no SQL porque a familia mora
 * dentro da chave: as linhas antigas (anteriores ao sufixo `@n`) sao a propria
 * familia, e um `like` teria que tratar os dois formatos. Sao poucas linhas por
 * jogo — a comparacao sai de graca em JS, com a mesma funcao pura do calculo.
 */
export async function alertasDoJogo(matchId: string): Promise<AlertaAnterior[]> {
  const { data, error } = await db()
    .from('arb_alerts')
    .select('dedupe_key, roi_pct, profit')
    .eq('match_id', matchId);
  if (error) throw new Error(`lendo alertas do jogo: ${error.message}`);
  return (data ?? []).map((a) => ({
    chave: a.dedupe_key as string,
    roiPct: Number(a.roi_pct),
    isArb: Number(a.profit) > 0,
  }));
}

export async function marcarNotificado(alertaId: number): Promise<void> {
  const { error } = await db()
    .from('arb_alerts')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', alertaId);
  if (error) throw new Error(`marcando notificado: ${error.message}`);
}

/** Feedback dos botoes do Telegram: a odd ainda existia na casa? */
export async function registrarConfirmacao(alertaId: number, confirmado: boolean): Promise<void> {
  const { error } = await db()
    .from('arb_alerts')
    .update({ confirmed: confirmado })
    .eq('id', alertaId);
  if (error) throw new Error(`registrando confirmacao: ${error.message}`);
}

export async function resumoAlertas(): Promise<
  Array<{ dia: string; alertas: number; roi_medio: number; roi_max: number; ainda_existiam: number; ja_tinham_sumido: number }>
> {
  const { data, error } = await db().from('v_arb_summary').select('*').limit(7);
  if (error) throw new Error(`lendo resumo: ${error.message}`);
  return (data ?? []) as never;
}
