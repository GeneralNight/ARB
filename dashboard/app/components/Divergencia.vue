<script setup lang="ts">
/**
 * Divergencia entre as duas fontes.
 *
 * O que se le aqui nao e o total, e o FORMATO. Duas assinaturas muito
 * diferentes, com consequencias muito diferentes:
 *
 *  - pequena, espalhada por todas as casas, e sempre com o direto MAIOR
 *    = truncagem do Flashscore (ele corta a odd em 2 decimais para baixo);
 *  - concentrada numa casa so, ou grande
 *    = adaptador com bug — e esse custa dinheiro.
 *
 * So aparece com `fonteDeOdds = ambos`, que e quando as duas rodam juntas.
 */
defineProps<{ dados: any }>()
</script>

<template>
  <section class="cartao" v-if="dados">
    <h2>divergencia entre fontes</h2>
    <p class="nota">
      Ultimas {{ dados.horas }} h. So e gravada quando as duas fontes discordam acima do ruido
      de arredondamento, e so no modo <code>ambos</code>.
    </p>

    <p v-if="!dados.total" class="vazio">
      Nada registrado. Se a fonte nao esta em <code>ambos</code>, e esperado — as duas precisam
      rodar juntas para haver o que comparar.
    </p>

    <template v-else>
      <p class="resumo">
        <strong>{{ dados.total }}</strong> divergencias ·
        <strong :class="dados.truncagem === dados.total ? 'bom' : 'alerta'">
          {{ Math.round((dados.truncagem / dados.total) * 100) }}%
        </strong>
        com o direto sempre maior.
        <span class="fraco">
          Perto de 100% e a assinatura da truncagem do Flashscore (vies conservador: ele so
          corta para baixo). Bem abaixo disso merece olhar — pode ser adaptador errado.
        </span>
      </p>

      <div class="tabela-rolavel">
        <table>
          <thead>
            <tr>
              <th>casa</th>
              <th class="num">ocorrencias</th>
              <th class="num">desvio medio</th>
              <th class="num">pior desvio</th>
              <th class="num">direto maior</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in dados.porCasa" :key="c.casa">
              <td>{{ c.casa }}</td>
              <td class="num fraco">{{ c.n }}</td>
              <td class="num">{{ c.desvioMedioPct.toFixed(2) }}%</td>
              <td class="num" :class="c.piorDesvioPct > 5 ? 'ruim' : c.piorDesvioPct > 1 ? 'alerta' : ''">
                {{ c.piorDesvioPct.toFixed(2) }}%
              </td>
              <td class="num" :class="c.pctSempreMaior > 90 ? 'fraco' : 'alerta'">
                {{ c.pctSempreMaior.toFixed(0) }}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.resumo { font-size: 13.5px; margin: 0 0 14px; }
.resumo .fraco { display: block; margin-top: 5px; font-size: 12.5px; }
code { font-family: var(--mono); font-size: 0.92em; }
</style>
