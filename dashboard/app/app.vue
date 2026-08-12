<script setup lang="ts">
/**
 * Painel do robo ARB.
 *
 * Uma pagina so, com atualizacao automatica. A ordem das secoes segue a ordem
 * das perguntas reais: o robo esta vivo? · chegou perto? · as fontes concordam? ·
 * as casas estao respondendo? · o que ele alertou?
 */
const INTERVALO_MS = 30_000

const janelaHoras = ref(24)
const atualizadoEm = ref<Date | null>(null)

const estado = await useFetch('/api/estado', { lazy: true })
const linhas = await useFetch('/api/linhas', { lazy: true, query: { horas: janelaHoras } })
const divergencia = await useFetch('/api/divergencia', { lazy: true, query: { horas: janelaHoras } })
const casas = await useFetch('/api/casas', { lazy: true })
const alertas = await useFetch('/api/alertas', { lazy: true })

async function atualizar() {
  await Promise.all([
    estado.refresh(),
    linhas.refresh(),
    divergencia.refresh(),
    casas.refresh(),
    alertas.refresh(),
  ])
  atualizadoEm.value = new Date()
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  atualizadoEm.value = new Date()
  timer = setInterval(atualizar, INTERVALO_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="pagina">
    <header class="topo">
      <div>
        <h1>ARB</h1>
        <p class="sub">detector de arbitragem 1X2</p>
      </div>
      <div class="acoes">
        <select v-model.number="janelaHoras" aria-label="janela de tempo">
          <option :value="6">6 h</option>
          <option :value="24">24 h</option>
          <option :value="72">3 dias</option>
          <option :value="168">7 dias</option>
        </select>
        <button type="button" @click="atualizar">atualizar</button>
        <span v-if="atualizadoEm" class="carimbo">
          {{ atualizadoEm.toLocaleTimeString('pt-BR') }}
        </span>
      </div>
    </header>

    <Estado :dados="estado.data.value" @mudou="atualizar" />
    <Casas :dados="casas.data.value" />
    <Linhas :dados="linhas.data.value" />
    <Divergencia :dados="divergencia.data.value" />
    <Alertas :dados="alertas.data.value" />

    <footer class="rodape">
      Atualiza sozinho a cada {{ INTERVALO_MS / 1000 }}s. Mudancas de configuracao valem no
      proximo ciclo do robo (ate ~1 min).
    </footer>
  </div>
</template>

<style>
:root {
  --fundo: #f6f7f9;
  --painel: #ffffff;
  --borda: #e2e5ea;
  --texto: #14171c;
  --fraco: #656d78;
  --acento: #2f6df6;
  --bom: #0f8a4f;
  --alerta: #b8860b;
  --ruim: #c8372d;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fundo: #0f1115;
    --painel: #171a20;
    --borda: #262b33;
    --texto: #e7eaee;
    --fraco: #939caa;
    --acento: #6f9bff;
    --bom: #3ec27c;
    --alerta: #d9a520;
    --ruim: #f4776a;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fundo);
  color: var(--texto);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.pagina { max-width: 1180px; margin: 0 auto; padding: 24px 20px 60px; }

.topo {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 22px;
}
.topo h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
.sub { margin: 2px 0 0; color: var(--fraco); font-size: 13px; }
.acoes { display: flex; align-items: center; gap: 10px; }
.carimbo { color: var(--fraco); font-size: 12px; font-family: var(--mono); }

button, select, input {
  font: inherit; color: var(--texto); background: var(--painel);
  border: 1px solid var(--borda); border-radius: 7px; padding: 6px 11px;
}
button { cursor: pointer; }
button:hover { border-color: var(--acento); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.cartao {
  background: var(--painel); border: 1px solid var(--borda);
  border-radius: 12px; padding: 18px; margin-bottom: 18px;
}
.cartao > h2 {
  margin: 0 0 4px; font-size: 15px; font-weight: 650;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--fraco);
}
.cartao > .nota { margin: 0 0 14px; color: var(--fraco); font-size: 13px; }

.tabela-rolavel { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--borda); white-space: nowrap; }
th { color: var(--fraco); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
tbody tr:last-child td { border-bottom: none; }
.num { font-family: var(--mono); text-align: right; }

.bom { color: var(--bom); }
.alerta { color: var(--alerta); }
.ruim { color: var(--ruim); }
.fraco { color: var(--fraco); }

.selo {
  display: inline-block; padding: 1px 8px; border-radius: 999px;
  font-size: 12px; border: 1px solid var(--borda); font-family: var(--mono);
}
.vazio { color: var(--fraco); font-size: 13.5px; padding: 6px 0; }
.rodape { color: var(--fraco); font-size: 12px; text-align: center; margin-top: 26px; }
</style>
