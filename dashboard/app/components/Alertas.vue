<script setup lang="ts">
/**
 * Alertas e o feedback do Telegram.
 *
 * A taxa de confirmacao e a unica medida do atraso REAL da fonte — se a odd
 * ainda estava la quando voce foi conferir. E o risco nº 1 do projeto, e sem os
 * cliques de ✅/❌ ele so pode ser chutado. Por isso "sem resposta" aparece:
 * e o que falta medir, nao um detalhe.
 */
defineProps<{ dados: any }>()

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
</script>

<template>
  <section class="cartao" v-if="dados">
    <h2>alertas</h2>
    <p class="nota">Ultimos {{ dados.dias }} dias.</p>

    <div class="fontes">
      <div class="fonte">
        <span class="rotulo">oportunidades</span>
        <strong>{{ dados.resumo.familias }}</strong>
        <span class="fraco pequeno">{{ dados.resumo.total }} mensagens</span>
      </div>
      <div class="fonte">
        <span class="rotulo">lucro apos arredondar</span>
        <strong :class="dados.resumo.comLucroReal ? 'bom' : 'alerta'">
          {{ dados.resumo.comLucroReal }}
        </strong>
        <span class="fraco pequeno">o unico que existe</span>
      </div>
      <div class="fonte">
        <span class="rotulo">odd ainda estava la</span>
        <strong :class="dados.resumo.taxaConfirmacao === null ? 'fraco' : dados.resumo.taxaConfirmacao > 0.6 ? 'bom' : 'ruim'">
          {{ dados.resumo.taxaConfirmacao === null ? 'sem dado' : `${Math.round(dados.resumo.taxaConfirmacao * 100)}%` }}
        </strong>
        <span class="fraco pequeno">
          {{ dados.resumo.confirmados }}✅ / {{ dados.resumo.negados }}❌
        </span>
      </div>
      <div class="fonte">
        <span class="rotulo">sem resposta</span>
        <strong class="fraco">{{ dados.resumo.semResposta }}</strong>
        <span class="fraco pequeno">clique no Telegram</span>
      </div>
    </div>

    <p v-if="!dados.alertas.length" class="vazio">
      Nenhum alerta na janela. Silencio longo costuma ser dedupe, nao defeito — confira
      "quao perto chegamos" antes de suspeitar do Telegram.
    </p>

    <div class="tabela-rolavel" v-else>
      <table>
        <thead>
          <tr>
            <th>jogo</th>
            <th>fonte</th>
            <th class="num">ROI</th>
            <th class="num">lucro</th>
            <th>conferido</th>
            <th>quando</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in dados.alertas" :key="a.id">
            <td>{{ a.jogo }}</td>
            <td><span class="selo">{{ a.source }}</span></td>
            <td class="num" :class="a.roi_pct > 0 ? 'bom' : 'alerta'">
              <strong>{{ a.roi_pct.toFixed(2) }}%</strong>
            </td>
            <td class="num">{{ a.profit === null ? '—' : `R$ ${a.profit.toFixed(2)}` }}</td>
            <td>
              <span v-if="a.confirmed === true" class="selo bom">estava la</span>
              <span v-else-if="a.confirmed === false" class="selo ruim">ja sumiu</span>
              <span v-else class="fraco">—</span>
            </td>
            <td class="fraco">{{ hora(a.detected_at) }}</td>
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
