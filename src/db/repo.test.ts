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
});
