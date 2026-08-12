/**
 * Controles do robo.
 *
 * Lista BRANCA estrita, por chave, com validacao por chave. O painel escreve na
 * mesma tabela `settings` que o robo rele a cada ciclo, entao um valor torto
 * aqui vira comportamento torto la em menos de um minuto.
 *
 * O robo tambem se defende (`z.enum().catch('flashscore')` em `src/config.ts`),
 * mas defesa em profundidade e barata e este e o unico ponto onde um humano
 * digita. As chaves NAO listadas aqui — curadoria de ligas, configs de casa,
 * pareamento manual — continuam so no painel do Supabase de proposito: sao as
 * que quebram silenciosamente.
 */

type Validador = (v: unknown) => unknown

const numeroPositivo = (nome: string): Validador => (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw createError({ statusCode: 400, statusMessage: `${nome} deve ser numero > 0` })
  return n
}

const PERMITIDAS: Record<string, Validador> = {
  fonteDeOdds: (v) => {
    if (!['flashscore', 'direto', 'ambos'].includes(String(v))) {
      throw createError({ statusCode: 400, statusMessage: 'fonteDeOdds invalida' })
    }
    return String(v)
  },
  pausado: (v) => Boolean(v),
  somenteCasasComConta: (v) => Boolean(v),
  banca: numeroPositivo('banca'),
  incrementoStake: numeroPositivo('incrementoStake'),
  // Negativo e proposital: modo calibracao, mostra quase-arbs.
  lucroMinimoPct: (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) throw createError({ statusCode: 400, statusMessage: 'lucroMinimoPct deve ser numero' })
    return n
  },
  janelaDias: (v) => {
    const n = Number(v)
    // 7 e teto rigido do feed do Flashscore: de +8 em diante ele devolve vazio.
    if (!Number.isInteger(n) || n < 0 || n > 7) {
      throw createError({ statusCode: 400, statusMessage: 'janelaDias deve ser inteiro de 0 a 7' })
    }
    return n
  },
  minutosAntesDoInicio: (v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw createError({ statusCode: 400, statusMessage: 'minutosAntesDoInicio >= 0' })
    return n
  },
}

export default defineEventHandler(async (event) => {
  const corpo = await readBody<Record<string, unknown>>(event)
  if (!corpo || typeof corpo !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'corpo vazio' })
  }

  const chaves = Object.keys(corpo)
  const proibidas = chaves.filter((k) => !(k in PERMITIDAS))
  if (proibidas.length > 0) {
    throw createError({ statusCode: 400, statusMessage: `chave nao permitida: ${proibidas.join(', ')}` })
  }
  if (chaves.length === 0) throw createError({ statusCode: 400, statusMessage: 'nada a mudar' })

  const s = db()
  const aplicadas: Record<string, unknown> = {}

  for (const chave of chaves) {
    const valor = PERMITIDAS[chave]!(corpo[chave])
    const { error } = await s
      .from('settings')
      .upsert({ key: chave, value: valor, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw createError({ statusCode: 500, statusMessage: `gravando ${chave}: ${error.message}` })
    aplicadas[chave] = valor
  }

  return { ok: true, aplicadas, aviso: 'vale no proximo ciclo do robo (ate ~1 min)' }
})
