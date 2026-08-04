/**
 * Acesso ao Supabase. Todas as escritas do robo passam por aqui.
 *
 * Regra de ouro deste arquivo: as colunas curadas por voce
 * (`competitions.enabled`, `bookmakers.has_account`, `bookmakers.max_stake`)
 * NUNCA sao tocadas por upsert automatico.
 */

import { RETENCAO_DIAS, SETTINGS_PADRAO, settingsSchema, type Settings } from '../config.js';
import type { Aposta, MelhorLinha } from '../arb/calc.js';
import type { Jogo, Liga } from '../flashscore/feed.js';
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

// ------------------------------------------------------------ competicoes

/**
 * Insere competicoes novas e atualiza nome/last_seen das existentes.
 *
 * `enabled` fica deliberadamente FORA do update: e a sua curadoria, e um sync
 * que a sobrescrevesse apagaria a configuracao inteira sem aviso.
 */
export async function upsertCompeticoes(ligas: Liga[]): Promise<void> {
  if (ligas.length === 0) return;
  const linhas = ligas.map((l) => ({
    id: l.id,
    name: l.nome,
    url_path: l.urlPath,
    country: l.pais,
    last_seen_at: new Date().toISOString(),
  }));
  const { error } = await db()
    .from('competitions')
    .upsert(linhas, { onConflict: 'id', ignoreDuplicates: false });
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

/** Mesma logica do upsert de ligas: `has_account` e `max_stake` sao seus. */
export async function upsertCasas(casas: Array<{ id: number; nome: string }>): Promise<void> {
  if (casas.length === 0) return;
  const linhas = casas.map((c) => ({
    id: c.id,
    name: c.nome,
    last_seen_at: new Date().toISOString(),
  }));
  const { error } = await db().from('bookmakers').upsert(linhas, { onConflict: 'id' });
  if (error) throw new Error(`upsert de casas: ${error.message}`);
}

export async function casasComConta(): Promise<Set<number>> {
  const { data, error } = await db().from('bookmakers').select('id').eq('has_account', true);
  if (error) throw new Error(`lendo casas com conta: ${error.message}`);
  return new Set((data ?? []).map((c) => c.id as number));
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

export async function gravarLineScan(matchId: string, linha: MelhorLinha): Promise<void> {
  const { error } = await db().from('line_scans').insert({
    match_id: matchId,
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
 * Grava o alerta. `dedupe_key` tem UNIQUE, entao o mesmo trio de casas no
 * mesmo jogo nao gera alerta repetido — a insercao duplicada e ignorada.
 */
export async function gravarAlerta(
  matchId: string,
  dedupeKey: string,
  aposta: Aposta,
  banca: number,
  snapshot: unknown,
): Promise<AlertaGravado | null> {
  const { data, error } = await db()
    .from('arb_alerts')
    .upsert(
      {
        match_id: matchId,
        dedupe_key: dedupeKey,
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
