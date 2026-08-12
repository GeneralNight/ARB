<script setup lang="ts">
/**
 * Saude das casas — a tela que explica silencio do sistema direto.
 *
 * Quase sempre a resposta e cobertura: casa sem adaptador, ou com adaptador que
 * nao pareou nada. Por isso as colunas sao "tem adaptador" e "jogos pareados",
 * e nao so o nome da casa.
 */
defineProps<{ dados: any }>()
</script>

<template>
  <section class="cartao" v-if="dados">
    <h2>casas</h2>
    <p class="nota">
      {{ dados.resumo.comAdaptador }} de {{ dados.resumo.total }} com adaptador ativo ·
      {{ dados.resumo.pareandoAlgo }} pareando jogos.
      <strong v-if="!dados.resumo.suficienteParaArbitragem" class="alerta">
        Abaixo de 3 casas o modo direto e silencioso por aritmetica — arbitragem 1X2 exige
        tres casas distintas.
      </strong>
    </p>

    <div class="tabela-rolavel">
      <table>
        <thead>
          <tr>
            <th>casa</th>
            <th>adaptador</th>
            <th class="num">ligas</th>
            <th class="num">jogos pareados</th>
            <th class="num">via betradar</th>
            <th>conta</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.linhas" :key="c.id">
            <td>
              <a v-if="c.url" :href="c.url" target="_blank" rel="noopener">{{ c.nome }}</a>
              <span v-else>{{ c.nome }}</span>
            </td>
            <td>
              <span v-if="c.temAdaptador && c.adaptadorAtivo" class="selo bom">{{ c.plataforma }}</span>
              <span v-else-if="c.temAdaptador" class="selo alerta">desativado</span>
              <span v-else class="fraco">—</span>
            </td>
            <td class="num" :class="{ fraco: !c.ligasMapeadas }">{{ c.ligasMapeadas || '—' }}</td>
            <td class="num" :class="{ fraco: !c.jogosPareados }">{{ c.jogosPareados || '—' }}</td>
            <td class="num fraco">{{ c.viaBetradar || '—' }}</td>
            <td>
              <span v-if="c.temConta" class="selo bom">sim</span>
              <span v-else class="fraco">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
a { color: var(--acento); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
