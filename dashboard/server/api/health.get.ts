/**
 * Healthcheck do Railway. Unica rota SEM autenticacao.
 *
 * Precisa ser aberta porque o healthcheck do Railway nao manda credencial, e
 * Basic Auth devolveria 401 — o deploy ficaria eternamente "unhealthy" e o
 * Railway derrubaria o servico.
 *
 * Por isso ela nao toca no banco e nao devolve nada: so prova que o processo
 * subiu e esta atendendo. Qualquer dado aqui vazaria sem senha.
 */
export default defineEventHandler(() => ({ ok: true }))
