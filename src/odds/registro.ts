/**
 * Escolhe como uma config vira adaptador.
 *
 * O declarativo e o caminho comum — casa nova costuma ser um JSON. Quando a
 * resposta nao cabe em "lista de eventos com odds dentro", a casa ganha um
 * adaptador TS com a mesma interface. Foi o caso do Altenar, cuja resposta e
 * relacional: um adaptador, nove casas.
 */

import type { ConfigCasa } from './esquema.js';
import { criarAdaptadorAltenar } from './casas/altenar.js';
import { criarAdaptadorCt } from './casas/ct.js';
import { criarAdaptador } from './motor.js';
import type { AdaptadorCasa } from './tipos.js';

export function criarAdaptadorDaConfig(
  config: ConfigCasa,
  competicoesDaCasa: () => Promise<string[]>,
  idsDeCompeticao: string[] = [],
): AdaptadorCasa {
  if (config.plataforma === 'ct') {
    // Odds em requisicao separada + credencial: nem o declarativo nem o
    // Altenar servem. E o primeiro adaptador com estado do projeto.
    return criarAdaptadorCt(config);
  }
  if (config.plataforma === 'altenar') {
    // As ligas ja mapeadas viram `champIds` e derrubam o payload de ~2,7 MB
    // para ~52 KB. Vazio na primeira coleta, que e quando elas sao descobertas.
    return criarAdaptadorAltenar(config, idsDeCompeticao);
  }
  return criarAdaptador(config, competicoesDaCasa);
}
