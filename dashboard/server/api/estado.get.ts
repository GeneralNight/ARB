/** Cabecalho do painel: o que o robo esta fazendo agora. */
export default defineEventHandler(async () => {
  const s = db()

  const settings = ou500(await s.from('settings').select('key, value'), 'settings')
  const porChave = Object.fromEntries(settings.map((l) => [l.key as string, l.value]))

  const [ligas, ligasOn, casas, configs, ultimo, alertas24h] = await Promise.all([
    s.from('competitions').select('*', { count: 'exact', head: true }),
    s.from('competitions').select('*', { count: 'exact', head: true }).eq('enabled', true),
    s.from('bookmakers').select('*', { count: 'exact', head: true }),
    s.from('bookmaker_configs').select('*', { count: 'exact', head: true }).eq('enabled', true),
    s.from('line_scans').select('scanned_at, source').order('scanned_at', { ascending: false }).limit(1),
    s
      .from('arb_alerts')
      .select('*', { count: 'exact', head: true })
      .gte('detected_at', new Date(Date.now() - 86_400_000).toISOString()),
  ])

  const ultimoScan = ultimo.data?.[0] ?? null

  return {
    fonteDeOdds: (porChave.fonteDeOdds as string) ?? 'flashscore',
    pausado: Boolean(porChave.pausado),
    banca: Number(porChave.banca ?? 0),
    lucroMinimoPct: Number(porChave.lucroMinimoPct ?? 0),
    janelaDias: Number(porChave.janelaDias ?? 0),
    filtroOutlierPct: Number(porChave.filtroOutlierPct ?? 0),
    incrementoStake: Number(porChave.incrementoStake ?? 1),
    somenteCasasComConta: Boolean(porChave.somenteCasasComConta),
    ligas: { total: ligas.count ?? 0, habilitadas: ligasOn.count ?? 0 },
    casas: { total: casas.count ?? 0, comAdaptador: configs.count ?? 0 },
    ultimoScan,
    alertas24h: alertas24h.count ?? 0,
    // Silencio longo costuma ser dedupe, nao defeito — mas silencio de VARREDURA
    // e outra coisa, e e o que este numero denuncia.
    minutosDesdeUltimoScan: ultimoScan
      ? Math.round((Date.now() - new Date(ultimoScan.scanned_at as string).getTime()) / 60_000)
      : null,
  }
})
