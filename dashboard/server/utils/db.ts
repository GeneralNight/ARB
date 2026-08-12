import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase do painel — SO no servidor.
 *
 * Mesma chave `service_role` que o robo usa. Ela ignora RLS, entao nunca pode
 * sair daqui: todo acesso do navegador passa pelas rotas `/api`, que sao
 * protegidas pelo Basic Auth.
 */
let cliente: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (cliente) return cliente

  const cfg = useRuntimeConfig()
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no painel.',
    })
  }

  cliente = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  return cliente
}

/** Erro do Supabase vira 500 com a mensagem original — diagnostico > estetica. */
export function ou500<T>(r: { data: T | null; error: { message: string } | null }, oque: string): T {
  if (r.error) throw createError({ statusCode: 500, statusMessage: `${oque}: ${r.error.message}` })
  return r.data as T
}
