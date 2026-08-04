import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url('SUPABASE_URL invalida'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY ausente'),
  TELEGRAM_BOT_TOKEN: z.string().min(10).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function carregarEnv(): Env {
  const r = envSchema.safeParse(process.env);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`.env incompleto:\n${problemas.join('\n')}\n\nCopie .env.example para .env e preencha.`);
  }
  return r.data;
}

/**
 * Teto da janela de varredura.
 *
 * O feed do Flashscore so devolve de -1 a +7 dias; de +8 em diante responde
 * vazio (verificado). Pedir mais que isso nao traz nada.
 */
export const JANELA_DIAS_MAX = 7;

/** Ajustaveis em tempo de execucao, lidos da tabela `settings` a cada ciclo. */
export interface Settings {
  banca: number;
  /** Limiar do alerta, em %. Aceita negativo (modo calibracao). */
  lucroMinimoPct: number;
  incrementoStake: number;
  somenteCasasComConta: boolean;
  minutosAntesDoInicio: number;
  /** 0 = so hoje · 1 = hoje + amanha · ... · 7 = teto do feed. */
  janelaDias: number;
  pausado: boolean;
}

export const SETTINGS_PADRAO: Settings = {
  banca: 1000,
  lucroMinimoPct: -1,
  incrementoStake: 1,
  somenteCasasComConta: false,
  minutosAntesDoInicio: 5,
  janelaDias: 0,
  pausado: false,
};

export const settingsSchema = z.object({
  banca: z.number().positive(),
  lucroMinimoPct: z.number(),
  incrementoStake: z.number().positive(),
  somenteCasasComConta: z.boolean(),
  minutosAntesDoInicio: z.number().min(0),
  janelaDias: z.number().int().min(0).max(JANELA_DIAS_MAX),
  pausado: z.boolean(),
});

/**
 * Concorrencia e pausa das chamadas ao Flashscore. API nao oficial: sem pressa.
 *
 * `maxPorCiclo` espalha a carga: o loop roda a cada minuto, entao 150 jogos
 * vencidos ao mesmo tempo viram ~6 minutos de trabalho suave em vez de uma
 * rajada unica. Os jogos mais proximos do apito sao servidos primeiro.
 *
 * Valores calibrados por observacao: com concorrencia 4 / pausa 150ms (~4,8
 * req/s) o Flashscore devolveu 429 depois de uso intenso. Em 3 / 400ms fica em
 * ~2 req/s, e um ciclo cheio de 25 jogos leva ~12s. Se rodar em datacenter
 * (Railway e afins), considere afrouxar mais: IP de nuvem costuma ser tratado
 * com menos tolerancia que IP residencial.
 */
export const REDE = { concorrencia: 3, pausaMs: 400, maxPorCiclo: 25 } as const;

/** Dias apagados de `line_scans` para caber no tier gratuito do Supabase. */
export const RETENCAO_DIAS = 30;
