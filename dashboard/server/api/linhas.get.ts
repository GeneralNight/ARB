/**
 * "Quao perto chegamos" — a serie de `line_scans`.
 *
 * E a tabela que responde se vale arriscar dinheiro. Margem negativa = arbitragem
 * de verdade; perto de zero = quase la. O corte por `source` importa: comparar
 * medicao do Flashscore com medicao direta sem separar nao significa nada.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const horas = Math.min(Number(q.horas ?? 24), 24 * 30)
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString()

  const s = db()
  const linhas = ou500(
    await s
      .from('line_scans')
      .select(
        'id, match_id, scanned_at, s, margin_pct, best_home, best_draw, best_away, book_count, source',
      )
      .gte('scanned_at', desde)
      .order('margin_pct', { ascending: true })
      .limit(400),
    'line_scans',
  )

  const ids = [...new Set(linhas.map((l) => l.match_id as string))]
  const jogos = ids.length
    ? ou500(await s.from('matches').select('id, home, away, kickoff').in('id', ids), 'matches')
    : []
  const porId = new Map(jogos.map((j) => [j.id as string, j]))

  const porFonte: Record<string, { n: number; melhorMargem: number | null }> = {}
  for (const l of linhas) {
    const f = (l.source as string) ?? 'flashscore'
    const atual = porFonte[f] ?? { n: 0, melhorMargem: null }
    atual.n++
    const m = Number(l.margin_pct)
    if (atual.melhorMargem === null || m < atual.melhorMargem) atual.melhorMargem = m
    porFonte[f] = atual
  }

  return {
    horas,
    porFonte,
    // Ja vem ordenado pela melhor margem: o topo e o que quase deu certo.
    linhas: linhas.slice(0, 60).map((l) => {
      const j = porId.get(l.match_id as string)
      return {
        ...l,
        margin_pct: Number(l.margin_pct),
        jogo: j ? `${j.home} x ${j.away}` : (l.match_id as string),
        kickoff: j?.kickoff ?? null,
      }
    }),
  }
})
