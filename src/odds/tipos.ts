/**
 * Contrato do sistema de odds diretas.
 *
 * A fronteira com o resto do robo e uma so: um adaptador produz `EventoDaCasa[]`,
 * que o coletor converte em `OddsCasa[]` — o tipo que `src/arb/calc.ts` ja
 * consome. Nada abaixo daqui sabe o que e Flashscore.
 */

export interface EventoDaCasa {
  /** Id do jogo NA CASA. Nao tem relacao com o id do Flashscore. */
  idNaCasa: string;
  mandante: string;
  visitante: string;
  /** Unix em segundos, UTC. */
  kickoffUnix: number;
  /** Id do campeonato na casa — liga com `bookmaker_competitions`. */
  competicaoNaCasa?: string;
  /**
   * Id Betradar/Sportradar, quando a casa expoe.
   *
   * Vale ouro: onde duas fontes trazem este campo, o pareamento e exato e a
   * heuristica de nome de time nem roda. 97% dos jogos da Superbet tem.
   */
  betradarId?: string;
  /** 1X2 tempo integral, so com as tres pernas ativas. */
  casa: number;
  empate: number;
  fora: number;
}

export interface AdaptadorCasa {
  /** Id do Flashscore — continua sendo a PK de `bookmakers` em todo o projeto. */
  bookmakerId: number;
  nome: string;
  /**
   * Devolve o DIA INTEIRO, nao um jogo.
   *
   * E o que torna a coleta direta mais barata que o Flashscore: uma requisicao
   * da Superbet trouxe 257 jogos (~2,3 KB/jogo) contra 900 KB por jogo do
   * feed de odds do Flashscore. O custo passa a ser por casa, nao por jogo.
   *
   * `dia` e relativo a hoje: 0 = hoje, 1 = amanha.
   */
  listarDoDia(dia: number): Promise<EventoDaCasa[]>;
}
