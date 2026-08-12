/**
 * Painel do robo ARB.
 *
 * A chave `service_role` do Supabase fica em `runtimeConfig` (sem prefixo
 * `public`), entao existe so no servidor Nitro e nunca chega ao navegador.
 * Isso e o que permite manter o RLS como esta — "nega tudo, sem policy" — sem
 * abrir nenhum furo: quem le o banco e o servidor do painel, autenticado.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  devtools: { enabled: false },
  ssr: true,

  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    dashboardUser: process.env.DASHBOARD_USER || 'arb',
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
  },

  nitro: {
    // O Railway injeta PORT; o preset node-server respeita.
    preset: 'node-server',
  },
})
