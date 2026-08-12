/**
 * Divergencia entre Flashscore e odd direta.
 *
 * A leitura util nao e o total, e o FORMATO. Atraso de agregador aparece
 * pequeno e espalhado por todas as casas; adaptador com bug aparece como uma
 * casa muito fora do padrao das outras. Por isso a resposta traz o agregado por
 * casa, e nao so a lista.
 *
 * A primeira medicao (12/08/2026) mostrou truncagem: o Flashscore corta a odd
 * em 2 decimais sempre para baixo, o que empurra a margem para pior do que e.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const horas = Math.min(Number(q.horas ?? 24), 24 * 30)
  const desde = new Date(Date.now() - horas * 3_600_000).toISOString()

  const s = db()
  const linhas = ou500(
    await s
      .from('odds_divergencia')
      .select('*')
      .gte('scanned_at', desde)
      .order('scanned_at', { ascending: false })
      .limit(500),
    'odds_divergencia',
  )

  const casas = ou500(await s.from('bookmakers').select('id, name'), 'bookmakers')
  const nome = new Map(casas.map((c) => [c.id as number, c.name as string]))

  const desvio = (a: number, b: number) => (b === 0 ? 0 : Math.abs(a - b) / b)

  const enriquecidas = linhas.map((l) => {
    const pernas: Array<[number, number]> = [
      [Number(l.dir_casa), Number(l.fs_casa)],
      [Number(l.dir_empate), Number(l.fs_empate)],
      [Number(l.dir_fora), Number(l.fs_fora)],
    ]
    return {
      ...l,
      casa: nome.get(l.bookmaker_id as number) ?? `#${l.bookmaker_id}`,
      desvioMaxPct: Math.max(...pernas.map(([x, y]) => desvio(x, y))) * 100,
      // Direto MAIOR que o Flashscore em todas as pernas e a assinatura da
      // truncagem: o agregador so corta para baixo, nunca para cima.
      sempreMaior: pernas.every(([x, y]) => x >= y),
    }
  })

  const porCasa = new Map<string, { n: number; somaDesvio: number; piorDesvio: number; sempreMaior: number }>()
  for (const d of enriquecidas) {
    const a = porCasa.get(d.casa) ?? { n: 0, somaDesvio: 0, piorDesvio: 0, sempreMaior: 0 }
    a.n++
    a.somaDesvio += d.desvioMaxPct
    a.piorDesvio = Math.max(a.piorDesvio, d.desvioMaxPct)
    if (d.sempreMaior) a.sempreMaior++
    porCasa.set(d.casa, a)
  }

  return {
    horas,
    total: enriquecidas.length,
    truncagem: enriquecidas.filter((d) => d.sempreMaior).length,
    porCasa: [...porCasa.entries()]
      .map(([casa, a]) => ({
        casa,
        n: a.n,
        desvioMedioPct: a.somaDesvio / a.n,
        piorDesvioPct: a.piorDesvio,
        pctSempreMaior: (a.sempreMaior / a.n) * 100,
      }))
      .sort((x, y) => y.piorDesvioPct - x.piorDesvioPct),
    linhas: [...enriquecidas].sort((a, b) => b.desvioMaxPct - a.desvioMaxPct).slice(0, 50),
  }
})
