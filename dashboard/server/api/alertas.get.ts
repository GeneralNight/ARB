/**
 * Alertas e o feedback dos botoes do Telegram.
 *
 * O `confirmed` e a peca mais importante do projeto inteiro: e a unica medida
 * do ATRASO REAL da fonte — se a odd ainda estava la quando voce foi conferir.
 * Sem ele, o risco nº 1 fica sendo estimado no chute.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const dias = Math.min(Number(q.dias ?? 7), 365)
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()

  const s = db()
  const alertas = ou500(
    await s
      .from('arb_alerts')
      .select(
        'id, match_id, dedupe_key, detected_at, s, roi_pct, bankroll, profit, legs, notified_at, confirmed, bet_placed, actual_profit, source',
      )
      .gte('detected_at', desde)
      .order('detected_at', { ascending: false })
      .limit(200),
    'arb_alerts',
  )

  const ids = [...new Set(alertas.map((a) => a.match_id as string))]
  const jogos = ids.length
    ? ou500(await s.from('matches').select('id, home, away, kickoff').in('id', ids), 'matches')
    : []
  const porId = new Map(jogos.map((j) => [j.id as string, j]))

  const confirmados = alertas.filter((a) => a.confirmed === true).length
  const negados = alertas.filter((a) => a.confirmed === false).length

  // Familias, nao mensagens.
  //
  // `dedupe_key` e `familia@n`: uma linha por MENSAGEM enviada, para que cada
  // uma tenha seu botao de feedback. Contar linhas superestima oportunidades —
  // um mesmo trio que melhora tres vezes vira tres linhas e uma so chance.
  const familias = new Set(alertas.map((a) => String(a.dedupe_key).split('@')[0])).size

  // Lucro pos-arredondamento, que e o unico que existe: a casa nao aceita
  // R$ 33,333. Ja houve caso de margem teorica -0,13% virar R$ 0,16 em R$ 1.000.
  const comLucroReal = alertas.filter((a) => Number(a.profit ?? 0) > 0).length

  return {
    dias,
    resumo: {
      total: alertas.length,
      familias,
      comLucroReal,
      confirmados,
      negados,
      // A taxa que mede o atraso da fonte. Sem resposta suficiente, nao ha o que
      // concluir — melhor mostrar "sem dado" do que uma porcentagem de 2 cliques.
      taxaConfirmacao: confirmados + negados >= 5 ? confirmados / (confirmados + negados) : null,
      semResposta: alertas.filter((a) => a.confirmed === null).length,
    },
    alertas: alertas.map((a) => {
      const j = porId.get(a.match_id as string)
      return {
        ...a,
        roi_pct: Number(a.roi_pct),
        profit: a.profit === null ? null : Number(a.profit),
        jogo: j ? `${j.home} x ${j.away}` : (a.match_id as string),
        kickoff: j?.kickoff ?? null,
      }
    }),
  }
})
