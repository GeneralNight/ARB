/**
 * Adiciona (e habilita) uma liga manualmente pelo ID do Flashscore.
 *
 * O catalogo automatico so enxerga ligas com jogo nos proximos dias — uma liga
 * em pre-temporada nao aparece. Isto evita ficar travado esperando o calendario.
 *
 *   npm run add:liga -- Yq4hUnzQ "BRASIL: Brasileirao Betano"
 */

import { db } from '../db/client.js';

function extrairId(entrada: string): string {
  // Aceita tanto o ID puro quanto uma URL do Flashscore com o ID no final.
  const m = entrada.match(/([A-Za-z0-9]{8})\/?$/);
  return m?.[1] ?? entrada;
}

async function main(): Promise<void> {
  const [entrada, nome] = process.argv.slice(2);

  if (!entrada) {
    console.log('Uso: npm run add:liga -- <id-da-liga> ["Nome da liga"]');
    console.log('\nO id tem 8 caracteres e aparece no feed. Exemplos ja confirmados:');
    console.log('  Yq4hUnzQ  BRASIL: Brasileirao Betano');
    console.log('  vRtLP6rs  BRASIL: Brasileirao Serie B');
    console.log('  zFsJPnr6  BRASIL: Copa Betano do Brasil');
    console.log('  xIv3pZNg  BRASIL: Serie C - Primeira fase');
    process.exit(1);
  }

  const id = extrairId(entrada);

  const { data: existente } = await db()
    .from('competitions')
    .select('id, name, enabled')
    .eq('id', id)
    .maybeSingle();

  if (existente) {
    if (existente.enabled) {
      console.log(`"${existente.name}" ja estava habilitada.`);
      return;
    }
    const { error } = await db().from('competitions').update({ enabled: true }).eq('id', id);
    if (error) throw new Error(error.message);
    console.log(`"${existente.name}" habilitada.`);
    return;
  }

  if (!nome) {
    console.log(`A liga ${id} ainda nao esta no catalogo.`);
    console.log('Passe tambem o nome para cadastra-la:');
    console.log(`  npm run add:liga -- ${id} "BRASIL: Nome da Liga"`);
    process.exit(1);
  }

  const pais = nome.includes(':') ? nome.slice(0, nome.indexOf(':')).trim() : null;
  const { error } = await db()
    .from('competitions')
    .insert({ id, name: nome, country: pais, enabled: true });
  if (error) throw new Error(error.message);

  console.log(`"${nome}" cadastrada e habilitada.`);
  console.log('O sync vai completar url_path quando a liga voltar a ter jogos.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
