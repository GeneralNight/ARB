import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { carregarEnv } from '../config.js';

let cliente: SupabaseClient | null = null;

/**
 * Cliente Supabase com a chave service_role.
 *
 * service_role ignora RLS — e por isso que as tabelas ficam com RLS ligado e
 * sem nenhuma policy: nega tudo por padrao, e so este processo local escreve.
 * Esta chave nunca deve chegar ao navegador.
 */
export function db(): SupabaseClient {
  if (cliente) return cliente;
  const env = carregarEnv();
  cliente = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente;
}
