/**
 * Parser do feed de jogos do Flashscore.
 *
 * Formato proprio: tokens separados por `¬`, chave e valor separados por `÷`.
 * Um token `ZA` abre uma liga; os jogos seguintes pertencem a ela ate a
 * proxima `ZA`. Exemplo real:
 *
 *   ZA÷ARGENTINA: Liga Profesional¬ZEE÷naYhNOaA¬ZL÷/football/argentina/...¬
 *   AA÷A9tzvkkC¬AD÷1785848400¬AE÷Platense¬AF÷Talleres Cordoba¬
 */

import { buscarTexto } from './client.js';
import { feedDoDiaUrl } from './endpoints.js';

export interface Liga {
  id: string;
  nome: string;
  urlPath: string | null;
  pais: string | null;
}

export interface Jogo {
  id: string;
  ligaId: string;
  ligaNome: string;
  mandante: string;
  visitante: string;
  /** Horario de inicio. */
  kickoff: Date;
}

export interface FeedDoDia {
  ligas: Liga[];
  jogos: Jogo[];
}

/** "ARGENTINA: Liga Profesional" -> "ARGENTINA" */
function extrairPais(nomeLiga: string): string | null {
  const i = nomeLiga.indexOf(':');
  return i > 0 ? nomeLiga.slice(0, i).trim() : null;
}

export function parseFeed(raw: string): FeedDoDia {
  const ligas = new Map<string, Liga>();
  const jogos: Jogo[] = [];

  let ligaAtual: { id?: string; nome?: string; urlPath?: string } = {};
  // `cxMandante` guarda o nome vindo de CX. O feed nem sempre manda AE — em
  // ~2% dos jogos so vem CX, e ignorar isso descartava jogos silenciosamente.
  let jogoAtual: Partial<Jogo> & { cxMandante?: string } = {};

  for (const token of raw.split('¬')) {
    const sep = token.indexOf('÷');
    if (sep < 0) continue;

    const chave = token.slice(0, sep).replace(/^~/, '');
    const valor = token.slice(sep + 1);

    switch (chave) {
      case 'ZA': // nome da liga: abre um novo bloco
        ligaAtual = { nome: valor };
        break;
      case 'ZEE': // id da liga
        ligaAtual.id = valor;
        break;
      case 'ZL': // path da liga no site
        ligaAtual.urlPath = valor;
        if (ligaAtual.id && ligaAtual.nome && !ligas.has(ligaAtual.id)) {
          ligas.set(ligaAtual.id, {
            id: ligaAtual.id,
            nome: ligaAtual.nome,
            urlPath: valor,
            pais: extrairPais(ligaAtual.nome),
          });
        }
        break;

      case 'AA': // id do jogo: abre um novo jogo
        jogoAtual = { id: valor };
        break;
      case 'AD': // timestamp unix do inicio
        jogoAtual.kickoff = new Date(Number(valor) * 1000);
        break;
      case 'CX': // nome do mandante (sempre presente)
        jogoAtual.cxMandante = valor;
        break;
      case 'AE': // nome do mandante (nem sempre presente)
        jogoAtual.mandante = valor;
        break;
      case 'AF': { // visitante fecha o jogo
        const mandante = jogoAtual.mandante ?? jogoAtual.cxMandante;
        if (jogoAtual.id && mandante && jogoAtual.kickoff && ligaAtual.id) {
          jogos.push({
            id: jogoAtual.id,
            ligaId: ligaAtual.id,
            ligaNome: ligaAtual.nome ?? '',
            mandante,
            visitante: valor,
            kickoff: jogoAtual.kickoff,
          });
        }
        jogoAtual = {};
        break;
      }
    }
  }

  return { ligas: [...ligas.values()], jogos };
}

export async function buscarFeedDoDia(dia: number): Promise<FeedDoDia> {
  return parseFeed(await buscarTexto(feedDoDiaUrl(dia)));
}

/**
 * Jogos que ainda valem a pena varrer: pre-jogo apenas.
 *
 * Descarta o que ja comecou e tambem o que comeca em menos de
 * `minutosAntesDoInicio` — nesse ponto nao ha tempo habil de conferir a odd e
 * fechar tres apostas em tres casas diferentes.
 */
export function apenasPreJogo(
  jogos: Jogo[],
  minutosAntesDoInicio: number,
  agora = new Date(),
): Jogo[] {
  const corte = agora.getTime() + minutosAntesDoInicio * 60_000;
  return jogos.filter((j) => j.kickoff.getTime() > corte);
}
