<script setup lang="ts">
/**
 * "Quao perto chegamos" — a serie de `line_scans`.
 *
 * Margem negativa e arbitragem de verdade. O resumo por fonte fica em cima
 * porque comparar medicao do Flashscore com medicao direta sem separar nao
 * significa nada — e o teste de fonte direta depende exatamente dessa leitura.
 */
defineProps<{ dados: any }>()

const cor = (m: number) => (m < 0 ? 'bom' : m < 1 ? 'alerta' : '')
const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <section class="cartao" v-if="dados">
    <h2>quao perto chegamos</h2>
    <p class="nota">
      Melhores linhas das ultimas {{ dados.horas }} h. Margem e o juice combinado depois de
      escolher a melhor odd de cada resultado em tres casas distintas — negativa significa
      arbitragem.
    </p>

    <div class="fontes">
      <div v-for="(v, fonte) in dados.porFonte" :key="fonte" class="fonte">
        <span class="rotulo">{{ fonte }}</span>
        <strong :class="cor(v.melhorMargem ?? 99)">
          {{ v.melhorMargem === null ? '—' : `${v.melhorMargem.toFixed(2)}%` }}
        </strong>
        <span class="fraco pequeno">{{ v.n }} varreduras</span>
      </div>
      <p v-if="!Object.keys(dados.porFonte).length" class="vazio">
        Nenhuma varredura na janela.
      </p>
    </div>

    <div class="tabela-rolavel" v-if="dados.linhas.length">
      <table>
        <thead>
          <tr>
            <th>jogo</th>
            <th>fonte</th>
            <th class="num">casa</th>
            <th class="num">empate</th>
            <th class="num">fora</th>
            <th class="num">casas</th>
            <th class="num">margem</th>
            <th>quando</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in dados.linhas" :key="l.id">
            <td>{{ l.jogo }}</td>
            <td><span class="selo">{{ l.source }}</span></td>
            <td class="num">{{ Number(l.best_home).toFixed(2) }}</td>
            <td class="num">{{ Number(l.best_draw).toFixed(2) }}</td>
            <td class="num">{{ Number(l.best_away).toFixed(2) }}</td>
            <td class="num fraco">{{ l.book_count }}</td>
            <td class="num" :class="cor(l.margin_pct)">
              <strong>{{ l.margin_pct.toFixed(2) }}%</strong>
            </td>
            <td class="fraco">{{ hora(l.scanned_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.fontes { display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 14px; }
.fonte { display: flex; flex-direction: column; gap: 3px; }
.rotulo { color: var(--fraco); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.fonte strong { font-size: 21px; font-family: var(--mono); }
.pequeno { font-size: 12px; }
</style>
