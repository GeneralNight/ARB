/**
 * Busca de competicoes pelo nome, usando a API de busca do Flashscore.
 *
 * Complementa o catalogo do feed: o feed so devolve -1..+7 dias, entao liga em
 * pre-temporada (Premier League em agosto, por exemplo) simplesmente nao
 * aparece. A busca acha independente do calendario.
 */

import { buscaUrl } from './endpoints.js';
import { buscarJson } from './client.js';

export interface CompeticaoEncontrada {
  id: string;
  nome: string;
  pais: string | null;
  urlPath: string | null;
}

interface RegistroBusca {
  id: string;
  name: string;
  url?: string;
  type?: { id: number };
  defaultCountry?: { name?: string };
  gender?: { id: number };
}

export async function buscarCompeticoes(termo: string): Promise<CompeticaoEncontrada[]> {
  const bruto = await buscarJson<RegistroBusca[]>(buscaUrl(termo));
  if (!Array.isArray(bruto)) return [];

  return bruto
    .filter((r) => r.type?.id === 1) // so competicoes
    .map((r) => ({
      id: r.id,
      nome: r.name,
      pais: r.defaultCountry?.name ?? null,
      urlPath: r.url ?? null,
    }));
}

/**
 * Acha a competicao de um pais especifico.
 *
 * Necessario porque "Premier League" existe em uma duzia de paises e a busca
 * devolve todas juntas — sem o pais, escolher pelo primeiro resultado pegaria
 * a liga errada.
 */
export async function buscarNoPais(
  termo: string,
  pais: string,
): Promise<CompeticaoEncontrada | null> {
  const encontradas = await buscarCompeticoes(termo);
  const alvo = pais.toLowerCase();

  const exata = encontradas.find(
    (c) => c.pais?.toLowerCase() === alvo && c.nome.toLowerCase() === termo.toLowerCase(),
  );
  if (exata) return exata;

  return encontradas.find((c) => c.pais?.toLowerCase() === alvo) ?? null;
}
