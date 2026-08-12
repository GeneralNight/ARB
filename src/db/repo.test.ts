/**
 * Regressao do contrato de curadoria.
 *
 * `competitions.enabled` e `bookmakers.{has_account,max_stake,note,url}` sao do
 * usuario. O jeito de apaga-las e alguem acrescentar um campo ao upsert sem
 * perceber — nao ha erro, nao ha aviso, a configuracao some na proxima varredura.
 *
 * Estes testes olham as chaves que o sync monta, entao nao precisam de banco.
 */

import { describe, expect, it } from 'vitest';
import {
  COLUNAS_CURADAS,
  COLUNAS_DO_SYNC,
  linhasDeCasas,
  linhasDeCompeticoes,
  linhasDePareamentoDeCompeticoes,
  linhasDePareamentoDeEventos,
} from './repo.js';
import type { Liga } from '../flashscore/feed.js';

const LIGAS: Liga[] = [
  { id: 'Yq4hUnzQ', nome: 'Brasileirao Serie A', urlPath: 'brasil/serie-a', pais: 'Brasil' },
  { id: 'xGrwqq16', nome: 'Liga dos Campeoes', urlPath: 'europa/ucl', pais: 'Europa' },
];

const CASAS = [
  { id: 16, nome: 'bet365' },
  { id: 574, nome: 'Betano.br' },
];

describe('contrato de curadoria — competicoes', () => {
  it('escreve exatamente as colunas permitidas', () => {
    for (const linha of linhasDeCompeticoes(LIGAS)) {
      expect(Object.keys(linha).sort()).toEqual([...COLUNAS_DO_SYNC.competitions].sort());
    }
  });

  it('nunca inclui uma coluna curada', () => {
    for (const linha of linhasDeCompeticoes(LIGAS)) {
      for (const proibida of COLUNAS_CURADAS.competitions) {
        expect(linha).not.toHaveProperty(proibida);
      }
    }
  });
});

describe('contrato de curadoria — casas', () => {
  it('escreve exatamente as colunas permitidas', () => {
    for (const linha of linhasDeCasas(CASAS)) {
      expect(Object.keys(linha).sort()).toEqual([...COLUNAS_DO_SYNC.bookmakers].sort());
    }
  });

  it('nunca inclui uma coluna curada', () => {
    for (const linha of linhasDeCasas(CASAS)) {
      for (const proibida of COLUNAS_CURADAS.bookmakers) {
        expect(linha).not.toHaveProperty(proibida);
      }
    }
  });
});

/**
 * Pareamento casa<->Flashscore: mesmo contrato, mesmo risco.
 *
 * A correcao manual de um pareamento errado e curadoria tanto quanto `enabled`.
 * Se o sync a sobrescrevesse, o usuario consertaria a liga hoje e ela voltaria
 * errada amanha — e pareamento errado soma odds de partidas diferentes.
 */
const PARES_COMPETICAO = [
  { bookmakerId: 933, competitionId: 'Yq4hUnzQ', competitionIdCasa: '90153', score: 1 },
];
const PARES_EVENTO = [
  { bookmakerId: 933, matchId: 'r9z6gEre', eventIdCasa: '13933710', score: 1, via: 'betradar' },
];

describe('contrato de curadoria — pareamento', () => {
  it('escreve exatamente as colunas permitidas', () => {
    for (const linha of linhasDePareamentoDeCompeticoes(PARES_COMPETICAO)) {
      expect(Object.keys(linha).sort()).toEqual([...COLUNAS_DO_SYNC.bookmaker_competitions].sort());
    }
    for (const linha of linhasDePareamentoDeEventos(PARES_EVENTO)) {
      expect(Object.keys(linha).sort()).toEqual([...COLUNAS_DO_SYNC.bookmaker_events].sort());
    }
  });

  it('nunca inclui `manual`', () => {
    for (const linha of linhasDePareamentoDeCompeticoes(PARES_COMPETICAO)) {
      for (const proibida of COLUNAS_CURADAS.bookmaker_competitions) {
        expect(linha).not.toHaveProperty(proibida);
      }
    }
    for (const linha of linhasDePareamentoDeEventos(PARES_EVENTO)) {
      for (const proibida of COLUNAS_CURADAS.bookmaker_events) {
        expect(linha).not.toHaveProperty(proibida);
      }
    }
  });
});

/**
 * O cenario que de fato assusta: rodar o sync duas vezes sobre uma base ja
 * curada. Reproduz o merge do upsert do Postgres — so as colunas enviadas sao
 * sobrescritas — sem precisar de banco de verdade.
 */
function aplicarUpsert<T extends { id: string | number }>(
  tabela: Map<string | number, Record<string, unknown>>,
  linhas: T[],
): void {
  for (const linha of linhas) {
    tabela.set(linha.id, { ...(tabela.get(linha.id) ?? {}), ...linha });
  }
}

describe('sync repetido preserva a curadoria', () => {
  it('nao desabilita ligas que voce habilitou', () => {
    const tabela = new Map<string | number, Record<string, unknown>>([
      ['Yq4hUnzQ', { id: 'Yq4hUnzQ', name: 'nome antigo', enabled: true }],
      ['xGrwqq16', { id: 'xGrwqq16', name: 'nome antigo', enabled: false }],
    ]);

    aplicarUpsert(tabela, linhasDeCompeticoes(LIGAS));
    aplicarUpsert(tabela, linhasDeCompeticoes(LIGAS));

    expect(tabela.get('Yq4hUnzQ')?.enabled).toBe(true);
    expect(tabela.get('xGrwqq16')?.enabled).toBe(false);
    // o que o sync PODE atualizar continua atualizando
    expect(tabela.get('Yq4hUnzQ')?.name).toBe('Brasileirao Serie A');
  });

  it('nao apaga conta, stake maximo nem link das casas', () => {
    const tabela = new Map<string | number, Record<string, unknown>>([
      [16, { id: 16, name: 'bet365', has_account: true, max_stake: 500, note: 'limitada', url: 'https://bet365.bet.br' }],
    ]);

    aplicarUpsert(tabela, linhasDeCasas(CASAS));
    aplicarUpsert(tabela, linhasDeCasas(CASAS));

    const casa = tabela.get(16);
    expect(casa?.has_account).toBe(true);
    expect(casa?.max_stake).toBe(500);
    expect(casa?.note).toBe('limitada');
    expect(casa?.url).toBe('https://bet365.bet.br');
  });

  it('nao desfaz o pareamento que voce corrigiu a mao', () => {
    const tabela = new Map<string | number, Record<string, unknown>>([
      ['933:Yq4hUnzQ', { id: '933:Yq4hUnzQ', competition_id_casa: '11111', manual: true }],
    ]);

    // `upsertPareamentoDeCompeticoes` filtra as manuais ANTES de escrever, entao
    // a linha curada nem chega ao upsert. Aqui vale a mesma prova das outras:
    // mesmo que chegasse, `manual` nunca esta entre as colunas enviadas.
    const linhas = linhasDePareamentoDeCompeticoes(PARES_COMPETICAO).map((l) => ({
      ...l,
      id: `${l.bookmaker_id}:${l.competition_id}`,
    }));
    aplicarUpsert(tabela, linhas);
    aplicarUpsert(tabela, linhas);

    expect(tabela.get('933:Yq4hUnzQ')?.manual).toBe(true);
  });
});
