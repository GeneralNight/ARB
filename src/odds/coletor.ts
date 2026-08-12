/**
 * Junta as odds de todas as casas configuradas, por jogo.
 *
 * A inversao que faz este sistema ser mais barato que o Flashscore mora aqui:
 * pede-se o DIA INTEIRO de cada casa (uma requisicao devolveu 257 jogos da
 * Superbet, ~2,3 KB/jogo) em vez de um jogo por vez (900 KB cada no Flashscore).
 * O custo passa a ser `casas x dias`, sem depender de quantos jogos ha.
 *
 * A saida e `OddsCasa[]` — exatamente o que `bestLine` ja consome. Daqui para
 * frente os dois sistemas sao identicos, e e de proposito: o modo `ambos` so
 * mede alguma coisa porque a matematica e a mesma dos dois lados.
 */

import type { OddsCasa } from '../arb/calc.js';
import type { Jogo } from '../flashscore/feed.js';
import * as repo from '../db/repo.js';
import { criarAdaptadorDaConfig } from './registro.js';
import { derivarCompeticoes, parear } from './pareamento.js';
import type { AdaptadorCasa, EventoDaCasa } from './tipos.js';

export interface ResultadoColeta {
  /** matchId -> odds de cada casa que oferece aquele jogo. */
  porJogo: Map<string, OddsCasa[]>;
  casasConsultadas: number;
  casasComFalha: Array<{ nome: string; erro: string }>;
  configsRejeitadas: Array<{ bookmakerId: number; erro: string }>;
  eventosVistos: number;
  jogosPareados: number;
}

/** Dias distintos que a janela de varredura toca, relativos a hoje. */
function diasDaJanela(jogos: Jogo[], agora = new Date()): number[] {
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const dias = new Set<number>();
  for (const j of jogos) {
    const d = j.kickoff;
    const dia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    dias.add(Math.round((dia - hoje) / 86_400_000));
  }
  return [...dias].sort((a, b) => a - b);
}

async function eventosDaCasa(adaptador: AdaptadorCasa, dias: number[]): Promise<EventoDaCasa[]> {
  const eventos: EventoDaCasa[] = [];
  for (const dia of dias) eventos.push(...(await adaptador.listarDoDia(dia)));
  return eventos;
}

export async function coletarOdds(jogos: Jogo[]): Promise<ResultadoColeta> {
  const { configs, rejeitadas } = await repo.configsDeCasas();

  const resultado: ResultadoColeta = {
    porJogo: new Map(),
    casasConsultadas: 0,
    casasComFalha: [],
    configsRejeitadas: rejeitadas,
    eventosVistos: 0,
    jogosPareados: 0,
  };
  if (jogos.length === 0 || configs.length === 0) return resultado;

  const dias = diasDaJanela(jogos);

  for (const config of configs) {
    // Uma leitura so do mapa de ligas: serve de filtro depois e, nas casas que
    // aceitam, ja entra na propria requisicao para encolher o payload.
    const mapaLigas = await repo.competicoesDaCasa(config.bookmakerId);
    const idsDeCompeticao = [...mapaLigas.values()];

    // Armadilha evitada: pedir so as ligas conhecidas impede DESCOBRIR liga
    // nova. Se a Premier League estrear amanha, ela nunca viria no payload
    // filtrado, nunca seria pareada e nunca entraria no mapa — o robo ficaria
    // cego para ela em silencio, que e o pior tipo de falha aqui.
    //
    // Entao o filtro so vale quando TODA liga da janela ja esta mapeada nesta
    // casa. Caso contrario, busca cheia e a descoberta acontece. Na pratica isso
    // e barato: a janela costuma ter poucas ligas, quase sempre ja mapeadas, e a
    // busca cheia so volta quando uma liga nova comeca a jogar.
    //
    // Custo residual conhecido: casa que NAO oferece uma das ligas habilitadas
    // nunca a mapeia, entao paga busca cheia sempre. Aceitavel enquanto as ligas
    // habilitadas forem grandes; se virar problema, o conserto e marcar a
    // ausencia no banco em vez de reconsultar.
    const ligasDaJanela = new Set(jogos.map((j) => j.ligaId));
    const tudoMapeado = [...ligasDaJanela].every((l) => mapaLigas.has(l));
    const filtroDeLigas = tudoMapeado ? idsDeCompeticao : [];

    const adaptador = criarAdaptadorDaConfig(config, async () => idsDeCompeticao, filtroDeLigas);

    let eventos: EventoDaCasa[];
    try {
      eventos = await eventosDaCasa(adaptador, dias);
    } catch (err) {
      // Casa que falha sai do ciclo sozinha. Nunca ha queda para o Flashscore:
      // misturar odd confiavel com odd defasada no mesmo bestLine e o defeito
      // que este sistema existe para eliminar.
      resultado.casasComFalha.push({
        nome: config.nome,
        erro: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    resultado.casasConsultadas++;
    resultado.eventosVistos += eventos.length;

    const pares: Array<{ bookmakerId: number; matchId: string; eventIdCasa: string; score: number; via: string }> = [];
    const votosDeLiga: Array<{ competitionId: string; competicaoNaCasa: string }> = [];

    for (const jogo of jogos) {
      const ligaNaCasa = mapaLigas.get(jogo.ligaId);
      const candidatos = ligaNaCasa
        ? eventos.filter((e) => e.competicaoNaCasa === ligaNaCasa)
        : eventos;

      const achado = parear(
        {
          mandante: jogo.mandante,
          visitante: jogo.visitante,
          kickoffUnix: Math.floor(jogo.kickoff.getTime() / 1000),
        },
        candidatos,
      );
      if (!achado) continue;

      const linha: OddsCasa = {
        bookmakerId: config.bookmakerId,
        nome: config.nome,
        casa: achado.evento.casa,
        empate: achado.evento.empate,
        fora: achado.evento.fora,
      };
      const atuais = resultado.porJogo.get(jogo.id) ?? [];
      atuais.push(linha);
      resultado.porJogo.set(jogo.id, atuais);

      pares.push({
        bookmakerId: config.bookmakerId,
        matchId: jogo.id,
        eventIdCasa: achado.evento.idNaCasa,
        score: achado.score,
        via: achado.via,
      });
      if (achado.evento.competicaoNaCasa) {
        votosDeLiga.push({
          competitionId: jogo.ligaId,
          competicaoNaCasa: achado.evento.competicaoNaCasa,
        });
      }
    }

    // Persistir o pareamento nao alimenta o ciclo — alimenta a AUDITORIA. E o
    // que permite conferir no painel por que uma casa entrou num jogo, e
    // corrigir a mao (coluna `manual`, que nenhum sync sobrescreve).
    await repo.upsertPareamentoDeEventos(pares);
    await repo.upsertPareamentoDeCompeticoes(
      derivarCompeticoes(votosDeLiga).map((m) => ({
        bookmakerId: config.bookmakerId,
        competitionId: m.competitionId,
        competitionIdCasa: m.competicaoNaCasa,
        score: m.score,
      })),
    );
  }

  resultado.jogosPareados = resultado.porJogo.size;
  return resultado;
}
