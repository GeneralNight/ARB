import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validarConfig } from './esquema.js';

const DIR = 'src/odds/casas';
const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('configs de casa versionadas', () => {
  it('existe pelo menos uma', () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.each(arquivos)('%s passa pelo esquema', (arq) => {
    const r = validarConfig(JSON.parse(readFileSync(`${DIR}/${arq}`, 'utf8')));
    if (!r.ok) throw new Error(`${arq}: ${r.erro}`);
    expect(r.ok).toBe(true);
  });

  it('nenhum bookmakerId repetido — duas configs para a mesma casa e ambiguidade', () => {
    const ids = arquivos.map((arq) => {
      const r = validarConfig(JSON.parse(readFileSync(`${DIR}/${arq}`, 'utf8')));
      return r.ok ? r.config.bookmakerId : -1;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validarConfig', () => {
  it('trata config sem `plataforma` como declarativa (compatibilidade)', () => {
    const r = validarConfig({
      bookmakerId: 1,
      nome: 'X',
      busca: 'por-data',
      requisicao: { url: 'https://x/{data}' },
      extracao: {
        eventos: 'data',
        idNaCasa: 'id',
        times: { campo: 'n', separador: '·' },
        kickoff: { campo: 'k', unidade: 'ms' },
        mercado: { lista: 'o', chave: 'c', preco: 'p', casa: '1', empate: '0', fora: '2' },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.plataforma).toBe('declarativa');
  });

  it('recusa altenar sem integration, com motivo legivel', () => {
    const r = validarConfig({ bookmakerId: 1, nome: 'X', plataforma: 'altenar' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain('integration');
  });

  it('recusa plataforma desconhecida em vez de adivinhar', () => {
    expect(validarConfig({ bookmakerId: 1, nome: 'X', plataforma: 'kambi' }).ok).toBe(false);
  });
});
