/**
 * Saude das casas.
 *
 * A pergunta que esta tela responde: por que o sistema direto esta silencioso?
 * Quase sempre a resposta e cobertura — `bestLine` exige TRES casas distintas,
 * entao casa sem adaptador, ou com adaptador que nao pareou nada, e o motivo.
 */
export default defineEventHandler(async () => {
  const s = db()

  const [casas, configs, pareamentos, ligas] = await Promise.all([
    s.from('bookmakers').select('id, name, url, has_account, max_stake, last_seen_at').order('name'),
    s.from('bookmaker_configs').select('bookmaker_id, config, enabled, updated_at'),
    s.from('bookmaker_events').select('bookmaker_id, via'),
    s.from('bookmaker_competitions').select('bookmaker_id'),
  ])

  const porCasa = new Map(
    (ou500(configs, 'bookmaker_configs') ?? []).map((c) => [c.bookmaker_id as number, c]),
  )

  const jogosPareados = new Map<number, number>()
  const viaBetradar = new Map<number, number>()
  for (const p of ou500(pareamentos, 'bookmaker_events') ?? []) {
    const id = p.bookmaker_id as number
    jogosPareados.set(id, (jogosPareados.get(id) ?? 0) + 1)
    if (p.via === 'betradar') viaBetradar.set(id, (viaBetradar.get(id) ?? 0) + 1)
  }

  const ligasMapeadas = new Map<number, number>()
  for (const l of ou500(ligas, 'bookmaker_competitions') ?? []) {
    const id = l.bookmaker_id as number
    ligasMapeadas.set(id, (ligasMapeadas.get(id) ?? 0) + 1)
  }

  const linhas = (ou500(casas, 'bookmakers') ?? []).map((c) => {
    const id = c.id as number
    const cfg = porCasa.get(id)
    const config = (cfg?.config ?? null) as Record<string, unknown> | null
    return {
      id,
      nome: c.name as string,
      url: c.url as string | null,
      temConta: Boolean(c.has_account),
      maxStake: c.max_stake as number | null,
      temAdaptador: Boolean(cfg),
      adaptadorAtivo: Boolean(cfg?.enabled),
      plataforma: (config?.plataforma as string) ?? (cfg ? 'declarativa' : null),
      jogosPareados: jogosPareados.get(id) ?? 0,
      viaBetradar: viaBetradar.get(id) ?? 0,
      ligasMapeadas: ligasMapeadas.get(id) ?? 0,
      ultimaVez: c.last_seen_at as string | null,
    }
  })

  const comAdaptador = linhas.filter((l) => l.temAdaptador && l.adaptadorAtivo).length

  return {
    linhas,
    resumo: {
      total: linhas.length,
      comAdaptador,
      // Abaixo de 3, arbitragem 1X2 e impossivel por aritmetica, nao por azar.
      suficienteParaArbitragem: comAdaptador >= 3,
      pareandoAlgo: linhas.filter((l) => l.jogosPareados > 0).length,
    },
  }
})
