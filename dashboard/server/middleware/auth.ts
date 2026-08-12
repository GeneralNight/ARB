/**
 * Basic Auth em tudo.
 *
 * O painel carrega a `service_role`, que ignora RLS e pode ler e escrever o
 * banco inteiro, e ainda tem controles que mexem no robo. Publicado no Railway
 * sem tranca, qualquer um com a URL viraria dono do projeto.
 *
 * Falha FECHADA de proposito: sem `DASHBOARD_PASSWORD` configurada, nada
 * responde. O modo de falha perigoso aqui e subir "funcionando" e aberto —
 * ninguem percebe. Recusar tudo e barulhento, e barulhento e o certo.
 */
/**
 * Unica excecao: o healthcheck do Railway, que nao manda credencial.
 *
 * Comparacao exata, sem `startsWith`: prefixo abriria `/api/healthxyz` e
 * qualquer coisa que alguem pendurasse depois. A rota nao le o banco nem
 * devolve dado — so prova que o processo subiu.
 */
const ABERTAS = new Set(['/api/health'])

export default defineEventHandler((event) => {
  const caminho = getRequestURL(event).pathname
  if (ABERTAS.has(caminho)) return

  const cfg = useRuntimeConfig()

  if (!cfg.dashboardPassword) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'DASHBOARD_PASSWORD nao configurada. O painel usa service_role e nao sobe sem senha.',
    })
  }

  const header = getRequestHeader(event, 'authorization') ?? ''
  const [tipo, credencial] = header.split(' ')

  if (tipo === 'Basic' && credencial) {
    const [usuario, senha] = Buffer.from(credencial, 'base64').toString('utf8').split(':')
    if (usuario === cfg.dashboardUser && senha === cfg.dashboardPassword) return
  }

  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="ARB", charset="UTF-8"')
  throw createError({ statusCode: 401, statusMessage: 'Nao autorizado' })
})
