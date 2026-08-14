/**
 * Esquema da config declarativa de uma casa.
 *
 * Arquivo unico de propósito: a fonte da verdade da config e o banco
 * (`bookmaker_configs`), editavel pelo painel do Supabase hoje e pelo painel
 * Nuxt depois. Config vinda de um formulario nao e confiavel, entao a validacao
 * mora aqui e o robo a aplica na LEITURA — config invalida tira aquela casa do
 * ciclo, com log, sem derrubar a varredura.
 */

import { z } from 'zod';

/** Como a casa aceita ser consultada, da mais barata para a mais cara. */
export const buscaSchema = z.enum(['por-data', 'por-esporte', 'por-competicao']);
export type Busca = z.infer<typeof buscaSchema>;

const caminho = z.string().min(1, 'caminho vazio');

export const kickoffSchema = z.object({
  campo: caminho,
  /** `ms`/`s` = numero epoch · `iso` = string que `Date.parse` entenda. */
  unidade: z.enum(['ms', 's', 'iso']),
});

export const mercadoSchema = z.object({
  /** Caminho da lista de cotacoes dentro do evento. */
  lista: caminho,
  /** Só os itens que casarem com todos estes pares entram. */
  filtro: z.record(z.union([z.string(), z.number()])).default({}),
  /**
   * Como saber se a cotacao esta valendo.
   *
   * Odd suspensa nao e apostavel — o sistema do Flashscore ja respeita isso via
   * `active`, e o direto precisa respeitar igual, senao o robo alerta arbitragem
   * montada sobre uma perna morta.
   */
  ativo: z.object({ campo: caminho, valor: z.string() }).optional(),
  /** Campo que diz qual resultado a cotacao representa. */
  chave: caminho,
  preco: caminho,
  /** Valores de `chave` que identificam cada perna. */
  casa: z.string(),
  empate: z.string(),
  fora: z.string(),
});

export const extracaoSchema = z.object({
  /** Caminho da lista de eventos na resposta. */
  eventos: caminho,
  idNaCasa: caminho,
  competicao: caminho.optional(),
  betradarId: caminho.optional(),
  /**
   * Nomes dos times.
   *
   * Duas formas porque as casas se dividem: ou trazem campos separados, ou um
   * `matchName` unico para partir. A Superbet e do segundo tipo ("Monterrey·Nashville").
   */
  times: z.union([
    z.object({ mandante: caminho, visitante: caminho }),
    z.object({ campo: caminho, separador: z.string().min(1) }),
  ]),
  kickoff: kickoffSchema,
  mercado: mercadoSchema,
});

const comum = {
  /** Id do Flashscore — PK de `bookmakers`. A config declara qual casa serve. */
  bookmakerId: z.number().int().positive(),
  nome: z.string().min(1),
};

/** Casa cuja resposta cabe no motor declarativo (evento com odds aninhadas). */
export const configDeclarativaSchema = z.object({
  ...comum,
  plataforma: z.literal('declarativa'),
  busca: buscaSchema,
  requisicao: z.object({
    url: z.string().min(1),
    headers: z.record(z.string()).default({}),
  }),
  extracao: extracaoSchema,
});

/**
 * Casa em plataforma Altenar.
 *
 * Nao cabe no declarativo: a resposta e RELACIONAL, com `events`, `markets`,
 * `odds` e `competitors` em arrays separados ligados por id. Extrair exige
 * junção, nao caminho — entao vira adaptador TS (`src/odds/casas/altenar.ts`),
 * que e a saida que o motor sempre previu para casa que nao encaixa.
 *
 * Nove casas brasileiras rodam nela, entao o adaptador se paga: muda so o
 * `integration`.
 */
export const configAltenarSchema = z.object({
  ...comum,
  plataforma: z.literal('altenar'),
  /** Nome da integracao da casa no Altenar (ex.: "esportiva", "goldebet"). */
  integration: z.string().min(1),
});

/**
 * Casa em plataforma CT/Sportradar (Bet7k e afins).
 *
 * Nao cabe no declarativo por dois motivos, cada um bastando sozinho: as odds
 * vem em requisicao SEPARADA da lista de jogos (o motor pressupoe odds
 * aninhadas no evento), e toda chamada exige credencial.
 *
 * A credencial e anonima e sai de um GET comum — `customerType: "anon"`,
 * `customerId: -1`. Nao ha login nem navegador no caminho, o que separa esta
 * casa das de `cf_clearance`: o token e emitido, nao arrancado.
 */
export const configCtSchema = z.object({
  ...comum,
  plataforma: z.literal('ct'),
  /** Origem do backend da casa, ex.: `https://prod20350-kbet-152319626.fssb.io`. */
  host: z.string().url(),
  /**
   * Caminho que emite o token anonimo por `Set-Cookie`.
   *
   * `operatorToken=logout` e o que pede a sessao ANONIMA. Sem ele a pagina
   * assume operador logado e nao emite nada — foi o detalhe que fez a casa
   * parecer inviavel na primeira sondagem.
   */
  bootstrap: z.string().min(1).default('/br-pt/spbkv4?operatorToken=logout'),
});

/**
 * `plataforma` ausente = declarativa.
 *
 * O preprocess existe porque `discriminatedUnion` nao aplica default no proprio
 * discriminante: sem isso, toda config gravada antes deste campo existir
 * passaria a ser invalida de uma vez — e config invalida tira a casa do ciclo.
 */
export const configCasaSchema = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !Array.isArray(v) && !('plataforma' in v)
      ? { ...(v as Record<string, unknown>), plataforma: 'declarativa' }
      : v,
  z.discriminatedUnion('plataforma', [configDeclarativaSchema, configAltenarSchema, configCtSchema]),
);

export type ConfigCasa = z.infer<typeof configCasaSchema>;
export type ConfigDeclarativa = z.infer<typeof configDeclarativaSchema>;
export type ConfigAltenar = z.infer<typeof configAltenarSchema>;
export type ConfigCt = z.infer<typeof configCtSchema>;
export type Extracao = z.infer<typeof extracaoSchema>;

/**
 * Valida sem lancar. Devolve o motivo legivel para ir ao log e, depois, ao painel.
 */
export function validarConfig(bruto: unknown): { ok: true; config: ConfigCasa } | { ok: false; erro: string } {
  const r = configCasaSchema.safeParse(bruto);
  if (r.success) return { ok: true, config: r.data };
  const problemas = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`);
  return { ok: false, erro: problemas.join('; ') };
}
