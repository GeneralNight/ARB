/**
 * Casa um jogo do calendario (Flashscore) com o evento correspondente na casa.
 *
 * Puro, sem I/O — mesma regra de `src/arb/calc.ts`, e pelo mesmo motivo: e aqui
 * que um bug custa dinheiro. Parear errado nao devolve odd errada, devolve odds
 * de OUTRA PARTIDA somadas como se fossem a mesma — arbitragem fantasma, que
 * parece boa demais justamente porque nao existe.
 *
 * Por isso a postura e recusar na duvida. Jogo nao pareado custa uma
 * oportunidade; jogo pareado errado custa a banca.
 */

import type { EventoDaCasa } from './tipos.js';

/**
 * Similaridade minima aceita, por time (Dice sobre bigramas).
 *
 * Calibrado contra o caso duro real: "Atletico-MG" x "Atletico Mineiro" da 0,70,
 * enquanto "Atletico Mineiro" x "Atletico Paranaense" da 0,45. O limiar precisa
 * passar o primeiro e barrar o segundo.
 */
export const SCORE_MINIMO = 0.62;

/**
 * Vantagem minima do 1o sobre o 2o colocado.
 *
 * Empate tecnico entre dois candidatos e RECUSA, nao escolha. Sem esta regra,
 * "Atletico-MG" acharia "Atletico Paranaense" aceitavel sempre que o Mineiro
 * nao estivesse na lista.
 */
export const MARGEM_MINIMA = 0.12;

/** Tolerancia de horario. Fontes diferentes arredondam o kickoff diferente. */
export const JANELA_KICKOFF_S = 90 * 60;

/**
 * Ruido societario que nunca distingue dois times.
 *
 * Deliberadamente curto. Sufixos como `II`, `B`, `U21` e `sub 20` NAO entram
 * aqui: eles distinguem o time principal do time reserva, e apaga-los faria
 * "JJK Jyvaskyla" e "JJK Jyvaskyla II" virarem o mesmo jogo — exatamente o tipo
 * de fusao errada que este modulo existe para impedir.
 */
const RUIDO = new Set(['fc', 'cf', 'sc', 'ec', 'ac', 'afc', 'cd', 'club', 'clube', 'futebol', 'football', 'fk', 'sk']);

export function normalizarTime(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const tokens = limpo.split(' ').filter(Boolean);
  const uteis = tokens.filter((t) => !RUIDO.has(t));
  // Se so sobrou ruido ("FC"), fica com o original: melhor comparar algo.
  return (uteis.length > 0 ? uteis : tokens).join(' ');
}

function bigramas(s: string): Set<string> {
  const compacto = s.replace(/ /g, '');
  const r = new Set<string>();
  for (let i = 0; i < compacto.length - 1; i++) r.add(compacto.slice(i, i + 2));
  return r;
}

/** Coeficiente de Dice: 1 = identico, 0 = nada em comum. */
export function pontuar(a: string, b: string): number {
  const na = normalizarTime(a);
  const nb = normalizarTime(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const ba = bigramas(na);
  const bb = bigramas(nb);
  if (ba.size === 0 || bb.size === 0) return 0;

  let comuns = 0;
  for (const g of ba) if (bb.has(g)) comuns++;
  return (2 * comuns) / (ba.size + bb.size);
}

export interface JogoParaParear {
  mandante: string;
  visitante: string;
  kickoffUnix: number;
  betradarId?: string;
}

export interface Pareamento {
  evento: EventoDaCasa;
  score: number;
  via: 'betradar' | 'nome';
}

/**
 * Escolhe o evento da casa que corresponde ao jogo, ou `null`.
 *
 * `candidatos` ja deve vir filtrado pela liga pareada — reduzir o espaco de
 * busca e o que mais derruba falso positivo, mais que qualquer limiar.
 */
export function parear(jogo: JogoParaParear, candidatos: EventoDaCasa[]): Pareamento | null {
  // Atalho exato: onde os dois lados expoem id Betradar, nao ha o que adivinhar.
  if (jogo.betradarId) {
    const exato = candidatos.filter((c) => c.betradarId === jogo.betradarId);
    // Mais de um evento com o mesmo id Betradar seria dado corrompido na casa;
    // aceitar o primeiro seria escolher no escuro.
    if (exato.length === 1) return { evento: exato[0]!, score: 1, via: 'betradar' };
    if (exato.length > 1) return null;
  }

  const naJanela = candidatos.filter(
    (c) => Math.abs(c.kickoffUnix - jogo.kickoffUnix) <= JANELA_KICKOFF_S,
  );

  const pontuados = naJanela
    .map((evento) => ({
      evento,
      // O elo mais fraco manda: acertar o mandante e errar o visitante e um par errado.
      score: Math.min(
        pontuar(jogo.mandante, evento.mandante),
        pontuar(jogo.visitante, evento.visitante),
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const melhor = pontuados[0];
  if (!melhor || melhor.score < SCORE_MINIMO) return null;

  const segundo = pontuados[1];
  if (segundo && melhor.score - segundo.score < MARGEM_MINIMA) return null;

  return { evento: melhor.evento, score: melhor.score, via: 'nome' };
}

/**
 * Pareia nomes de CAMPEONATO — e nao usa Dice de proposito.
 *
 * Nome de liga tem duas propriedades que nome de time nao tem, e as duas
 * quebram o Dice:
 *
 *  1. Patrocinador entra e sai ("Brasileirao Serie A" vs "Brasileirao Betano
 *     Serie A"). Bigramas punem o token extra, que e justamente o irrelevante.
 *  2. O que distingue duas ligas costuma ser UM caractere ("Serie A" vs
 *     "Serie B"). Bigramas quase nao veem essa diferenca — que e a unica que
 *     importa, porque parear a divisao errada erra a liga inteira de uma vez.
 *
 * Entao aqui a medida e CONTENCAO de tokens: quantos tokens do alvo aparecem no
 * candidato. Token extra no candidato nao pune (resolve o patrocinador), e token
 * faltando pune muito (resolve o A/B).
 */
export function pontuarCompeticao(alvo: string, candidato: string): number {
  const ta = new Set(normalizarTime(alvo).split(' ').filter(Boolean));
  const tc = new Set(normalizarTime(candidato).split(' ').filter(Boolean));
  if (ta.size === 0 || tc.size === 0) return 0;

  let comuns = 0;
  for (const t of ta) if (tc.has(t)) comuns++;

  // Um token em comum e coincidencia ("Liga" casa com qualquer liga). Exige-se
  // dois, salvo quando o alvo tem um token so e ele bate exatamente.
  if (comuns < 2 && !(ta.size === 1 && comuns === 1)) return 0;

  return comuns / ta.size;
}

/**
 * Deriva o mapa de campeonatos a partir dos jogos JA pareados.
 *
 * Melhor que parear por nome, e vale registrar por que: a Superbet nao publica
 * catalogo de torneios — o payload traz `tournamentId` mas nunca o nome, e nao
 * ha endpoint de listagem (testados `/tournaments`, `/sports/5/tournaments`,
 * `/categories`: todos 404). Parear por nome seria impossivel ali.
 *
 * Mas o pareamento de JOGO nao precisa da liga: nome de time + horario bastam.
 * Entao a liga sai de graca como subproduto — se cinco jogos da competicao
 * `Yq4hUnzQ` cairam todos no torneio `90153` da casa, o mapa e esse. Usa o sinal
 * mais forte que existe em vez do mais fraco, e funciona em toda casa,
 * publicando nome de liga ou nao.
 *
 * `parearCompeticao` (acima) continua valendo para casa que so busca por liga,
 * onde e preciso saber o id ANTES de ver qualquer jogo.
 */
export function derivarCompeticoes(
  votos: Array<{ competitionId: string; competicaoNaCasa: string }>,
  concordanciaMinima = 0.7,
): Array<{ competitionId: string; competicaoNaCasa: string; score: number }> {
  const porCompeticao = new Map<string, Map<string, number>>();
  for (const v of votos) {
    if (!v.competicaoNaCasa) continue;
    const contagem = porCompeticao.get(v.competitionId) ?? new Map<string, number>();
    contagem.set(v.competicaoNaCasa, (contagem.get(v.competicaoNaCasa) ?? 0) + 1);
    porCompeticao.set(v.competitionId, contagem);
  }

  const mapa: Array<{ competitionId: string; competicaoNaCasa: string; score: number }> = [];
  for (const [competitionId, contagem] of porCompeticao) {
    const total = [...contagem.values()].reduce((a, b) => a + b, 0);
    const [vencedor, votosVencedor] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const score = votosVencedor / total;
    // Liga do Flashscore espalhada entre varios torneios da casa e sinal de que
    // a casa fatia diferente (fases, grupos). Melhor nao mapear do que mapear mal.
    if (score >= concordanciaMinima) {
      mapa.push({ competitionId, competicaoNaCasa: vencedor, score });
    }
  }
  return mapa;
}

export function parearCompeticao<T extends { id: string; nome: string }>(
  alvo: string,
  candidatos: T[],
): { item: T; score: number } | null {
  const pontuados = candidatos
    .map((item) => ({ item, score: pontuarCompeticao(alvo, item.nome) }))
    .sort((a, b) => b.score - a.score);

  const melhor = pontuados[0];
  if (!melhor || melhor.score < SCORE_MINIMO) return null;
  const segundo = pontuados[1];
  if (segundo && melhor.score - segundo.score < MARGEM_MINIMA) return null;
  return melhor;
}
