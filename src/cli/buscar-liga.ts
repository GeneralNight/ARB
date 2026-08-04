/**
 * Procura uma competicao pelo nome e mostra o id para habilitar.
 *
 *   npm run buscar -- "premier league"
 *   npm run buscar -- "la liga" --habilitar Espanha
 *
 * Serve para as ligas que o catalogo do feed nao alcanca: o feed cobre so
 * -1..+7 dias, entao liga fora de temporada nao aparece la.
 */

import { buscarCompeticoes } from '../flashscore/busca.js';
import { db } from '../db/client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const iFlag = args.indexOf('--habilitar');
  const paisFiltro = iFlag >= 0 ? args[iFlag + 1] : null;
  const termo = (iFlag >= 0 ? args.slice(0, iFlag) : args).join(' ').trim();

  if (!termo) {
    console.log('Uso: npm run buscar -- "nome da liga" [--habilitar <Pais>]');
    console.log('\nExemplos:');
    console.log('  npm run buscar -- "premier league"');
    console.log('  npm run buscar -- "premier league" --habilitar Inglaterra');
    process.exit(1);
  }

  const encontradas = await buscarCompeticoes(termo);
  if (encontradas.length === 0) {
    console.log(`Nada encontrado para "${termo}".`);
    return;
  }

  const filtradas = paisFiltro
    ? encontradas.filter((c) => c.pais?.toLowerCase() === paisFiltro.toLowerCase())
    : encontradas;

  if (filtradas.length === 0) {
    console.log(`"${termo}" nao existe em "${paisFiltro}". Encontradas em outros paises:`);
    for (const c of encontradas.slice(0, 10)) {
      console.log(`  ${c.id}  ${(c.pais ?? '-').padEnd(18)} ${c.nome}`);
    }
    return;
  }

  console.log(`${filtradas.length} resultado(s) para "${termo}":\n`);

  // Quais ja estao no banco, e habilitadas?
  const { data } = await db()
    .from('competitions')
    .select('id, enabled')
    .in('id', filtradas.map((c) => c.id));
  const estado = new Map((data ?? []).map((r) => [r.id as string, r.enabled as boolean]));

  for (const c of filtradas) {
    const st = estado.has(c.id) ? (estado.get(c.id) ? '✓ habilitada' : '  no catalogo') : '  nova';
    console.log(`  ${c.id}  ${(c.pais ?? '-').padEnd(18)} ${c.nome.padEnd(34)} ${st}`);
  }

  if (!paisFiltro) {
    console.log('\nPara habilitar uma delas:');
    console.log(`  npm run buscar -- "${termo}" --habilitar <Pais>`);
    console.log(`  npm run add:liga -- <id> "<Pais>: <Nome>"`);
    return;
  }

  // Com --habilitar: cadastra (se preciso) e liga.
  for (const c of filtradas) {
    const nomeCompleto = c.pais ? `${c.pais.toUpperCase()}: ${c.nome}` : c.nome;
    const { error } = await db().from('competitions').upsert(
      {
        id: c.id,
        name: nomeCompleto,
        country: c.pais?.toUpperCase() ?? null,
        url_path: c.urlPath,
        enabled: true,
      },
      { onConflict: 'id' },
    );
    if (error) {
      console.log(`\n  falhou em ${c.id}: ${error.message}`);
      continue;
    }
    console.log(`\n  ✓ "${nomeCompleto}" habilitada.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
