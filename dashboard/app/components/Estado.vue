<script setup lang="ts">
/**
 * Estado do robo e os controles.
 *
 * A troca de `fonteDeOdds` pede confirmacao quando levaria ao silencio: abaixo
 * de 3 casas com adaptador, o sistema direto nao produz nada por aritmetica —
 * `bestLine` exige tres casas distintas. Deixar virar a chave sem avisar seria
 * entregar um robô mudo que parece ligado.
 */
const props = defineProps<{ dados: any }>()
const emit = defineEmits<{ mudou: [] }>()

const salvando = ref(false)
const erro = ref<string | null>(null)

const casas = await useFetch('/api/casas', { lazy: true })
const comAdaptador = computed(() => casas.data.value?.resumo?.comAdaptador ?? 0)

async function gravar(mudanca: Record<string, unknown>) {
  erro.value = null
  salvando.value = true
  try {
    await $fetch('/api/settings', { method: 'PATCH', body: mudanca })
    emit('mudou')
  } catch (e: any) {
    erro.value = e?.statusMessage || e?.message || 'falhou'
  } finally {
    salvando.value = false
  }
}

async function trocarFonte(fonte: string) {
  if (fonte !== 'flashscore' && comAdaptador.value < 3) {
    const ok = confirm(
      `So ${comAdaptador.value} casa(s) tem adaptador. Arbitragem 1X2 precisa de 3 casas` +
        ' distintas, entao o modo direto ficara SILENCIOSO. Trocar mesmo assim?',
    )
    if (!ok) return
  }
  await gravar({ fonteDeOdds: fonte })
}

const atraso = computed(() => props.dados?.minutosDesdeUltimoScan)
const classeAtraso = computed(() =>
  atraso.value === null || atraso.value === undefined ? 'fraco' : atraso.value > 15 ? 'ruim' : 'bom',
)
</script>

<template>
  <section class="cartao" v-if="dados">
    <h2>estado</h2>

    <div class="grade">
      <div class="celula">
        <span class="rotulo">fonte de odds</span>
        <div class="botoes">
          <button
            v-for="f in ['flashscore', 'direto', 'ambos']"
            :key="f"
            type="button"
            :class="{ ativo: dados.fonteDeOdds === f }"
            :disabled="salvando"
            @click="trocarFonte(f)"
          >
            {{ f }}
          </button>
        </div>
      </div>

      <div class="celula">
        <span class="rotulo">robo</span>
        <button type="button" :disabled="salvando" @click="gravar({ pausado: !dados.pausado })">
          {{ dados.pausado ? '▶ retomar' : '⏸ pausar' }}
        </button>
      </div>

      <div class="celula">
        <span class="rotulo">ultima varredura</span>
        <strong :class="classeAtraso">
          {{ atraso === null || atraso === undefined ? 'nunca' : `ha ${atraso} min` }}
        </strong>
        <span v-if="dados.ultimoScan" class="fraco pequeno">
          fonte {{ dados.ultimoScan.source }}
        </span>
      </div>

      <div class="celula">
        <span class="rotulo">alertas 24 h</span>
        <strong>{{ dados.alertas24h }}</strong>
      </div>

      <div class="celula">
        <span class="rotulo">ligas habilitadas</span>
        <strong>{{ dados.ligas.habilitadas }}<span class="fraco">/{{ dados.ligas.total }}</span></strong>
      </div>

      <div class="celula">
        <span class="rotulo">casas com adaptador</span>
        <strong :class="comAdaptador >= 3 ? 'bom' : 'alerta'">
          {{ comAdaptador }}<span class="fraco">/{{ dados.casas.total }}</span>
        </strong>
      </div>
    </div>

    <div class="numeros">
      <label>
        banca R$
        <input
          type="number" min="1" step="10" :value="dados.banca" :disabled="salvando"
          @change="gravar({ banca: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label>
        limiar %
        <input
          type="number" step="0.1" :value="dados.lucroMinimoPct" :disabled="salvando"
          @change="gravar({ lucroMinimoPct: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <label>
        janela (dias)
        <input
          type="number" min="0" max="7" step="1" :value="dados.janelaDias" :disabled="salvando"
          @change="gravar({ janelaDias: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <span v-if="dados.lucroMinimoPct < 0" class="selo alerta">modo calibracao</span>
      <span v-if="dados.pausado" class="selo ruim">pausado</span>
    </div>

    <div class="numeros">
      <label class="filtro">
        <input
          type="checkbox" :checked="dados.filtroOutlierPct > 0" :disabled="salvando"
          @change="gravar({ filtroOutlierPct: ($event.target as HTMLInputElement).checked ? 25 : 0 })"
        />
        filtro de odd fora de mercado
      </label>
      <label v-if="dados.filtroOutlierPct > 0">
        limiar %
        <input
          type="number" min="1" max="200" step="5" :value="dados.filtroOutlierPct" :disabled="salvando"
          @change="gravar({ filtroOutlierPct: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
      <span class="fraco pequeno explica">
        Descarta a casa cuja odd passe desse % acima da mediana das outras. Só o lado alto —
        odd baixa nunca cria arbitragem falsa, então o filtro nunca inventa oportunidade,
        só suprime.
      </span>
    </div>

    <p v-if="erro" class="ruim pequeno">erro: {{ erro }}</p>
  </section>
</template>

<style scoped>
.grade {
  display: grid; gap: 14px; margin-bottom: 16px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.celula { display: flex; flex-direction: column; gap: 5px; }
.rotulo { color: var(--fraco); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.celula strong { font-size: 19px; font-family: var(--mono); font-weight: 600; }
.pequeno { font-size: 12px; }
.botoes { display: flex; gap: 5px; flex-wrap: wrap; }
.botoes button { padding: 5px 10px; font-size: 13px; }
.botoes button.ativo { border-color: var(--acento); color: var(--acento); font-weight: 600; }
.numeros {
  display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
  padding-top: 14px; border-top: 1px solid var(--borda);
}
.numeros label { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--fraco); }
.numeros input { width: 92px; font-family: var(--mono); }
.numeros input[type='checkbox'] { width: auto; }
.filtro { color: var(--texto); cursor: pointer; }
.explica { flex-basis: 100%; font-size: 12px; line-height: 1.45; }
</style>
