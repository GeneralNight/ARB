# ARB — detector de arbitragem 1X2

Robô que lê odds de ~25 casas no Flashscore, detecta arbitragem 1X2 pré-jogo
(apostar Casa/Empate/Fora em três casas diferentes e lucrar dê no que der) e
alerta no Telegram. **Não aposta** — o alerta é pista para conferir na casa.

Node 22 + TypeScript · Supabase (Postgres) · Telegram Bot API.
Interação com o usuário é **em português**.

```
S = 1/odd_casa + 1/odd_empate + 1/odd_fora
S < 1  →  arbitragem     ROI = 1/S − 1
stake_i = total × (1/odd_i) / S      → retorno igual nos 3 cenários
```

---

## Comandos

```bash
npm start                 # loop principal (ciclo de 1 min)
npm test                  # 29 testes — rode sempre após mexer em calc/parsers
npm run typecheck
npm run doctor            # valida os endpoints do Flashscore ao vivo
npm run scan:once         # varredura única + funil de filtragem no terminal
npm run scan:once -- <id> # inspeciona um jogo específico
npm run proximos          # jogos de hoje ainda não iniciados, por liga
npm run sync:competitions # descobre competições (dias -1..+7)
npm run buscar -- "nome"  # acha liga fora de temporada (API de busca)
npm run add:liga -- <id>  # cadastra/habilita liga manualmente
npm run test:telegram     # alerta de exemplo, espera 90s pelo clique

# sistema de odds diretas (segundo pipeline)
npm run sondar            # classifica o acesso das 27 casas → docs/casas-sondagem.md
npm run scan:direto       # varredura única pelo pipeline direto (sem Telegram)
npm run comparar          # Flashscore × odd direta, lado a lado
npm run comparar -- <id>  # idem, num jogo só
```

---

## Flashscore — conhecimento caro, não redescobrir

Não é API pública. Tudo abaixo foi verificado com resposta real em 03/08/2026.
`src/flashscore/endpoints.ts` é a fonte da verdade.

| | |
|---|---|
| `PROJECT_ID` | `401` (flashscore.com.br; o `.com` internacional é `2`) |
| `FSIGN` | `SW9D1eZo` — header `x-fsign`, obrigatório no feed |
| `ODDS_HASH` | `oce` |
| `LANG_ID` | `31` (pt-BR, para a API de busca) |
| Feed do dia | `https://401.flashscore.ninja/401/x/feed/f_1_{dia}_3_pt-br_1` |
| Odds | `https://global.ds.lsapp.eu/pq_graphql?_hash=oce&eventId=…&projectId=401&geoIpCode=BR&geoIpSubdivisionCode=BRSP` |
| Busca | `https://s.livesport.services/api/v2/search/?q=…&lang-id=31&project-id=401&project-type-id=1&sport-ids=1&type-ids=1` |

**Fatos que economizam horas:**

- O endpoint de odds é **persisted query**: só hashes pré-registrados passam.
  Hash errado → `404 Query not stored`. Esse 404 é o sinal de que o hash mudou.
- O feed antigo `df_od_*` está **morto** (responde sempre `0`). Não usar.
- O feed cobre **-1 a +7 dias**. De +8 em diante devolve vazio — é teto rígido,
  daí `JANELA_DIAS_MAX = 7`.
- A **API de busca usa os mesmos IDs do feed** (confirmado: buscar "brasileirao"
  devolve `Yq4hUnzQ`, idêntico ao `ZEE`). É como achar liga em pré-temporada,
  que o feed não mostra.
- A busca responde em **português**: procurar "champions league" devolve Premier
  League; o certo é "liga dos campeões".
- O **ID não muda entre fases**: `xGrwqq16` serve para "Liga dos Campeões -
  Qualificação" e para a fase principal.
- O Flashscore vira o dia no **fuso dele**. Depois de ~21h BRT, o "dia 0" já
  traz jogos de amanhã.

**Formato do feed** (`src/flashscore/feed.ts`): tokens separados por `¬`, chave
e valor por `÷`. `ZA` nome da liga · `ZEE` id · `ZL` path · `AA` id do jogo ·
`AD` kickoff unix · `AE` mandante · `CX` mandante (fallback) · `AF` visitante.

**Formato das odds** (`src/flashscore/odds.ts`):
- `settings.bookmakers[].bookmaker.{id,name}` — **aninhado**, fácil errar.
- Filtrar `bettingType === 'HOME_DRAW_AWAY'` **e** `bettingScope === 'FULL_TIME'`.
- **A ordem dos participantes é VISITANTE primeiro, mandante depois.** Não há
  `participantId`, `homeAway` nem `side` em lugar nenhum do payload — a ordem de
  aparição é o único sinal, e ela é invertida em relação ao intuitivo.
  Ficou errado até 12/08/2026 (ver "Armadilhas").
- Nos 3 itens: 2º participante → Casa · 1º participante → Fora ·
  **`eventParticipantId === null` → Empate**.
- Respeitar `active`; odd suspensa não é apostável.
- **Não há URL de casa em lugar nenhum do payload.** `bookmaker` traz só
  `{id, name}` + cores de bônus; `EventOdds` não tem link. O site monta o link
  no cliente, por redirecionador de afiliado. Daí `bookmakers.url` ser curada
  à mão — não procurar de novo no JSON.

### Quando quebrar

`npm run doctor` diz o quê. Para redescobrir o `_hash`, testar candidatos curtos
contra o endpoint (`404` = errado, `200` = certo) — foi assim que `oce` apareceu.
Para o resto: baixar `/res/_fs/build/runtime.<hash>.js` da home, achar no mapa de
chunks `oddsTab` e `OddsComparisonFsdsFeedParser`, baixar esses chunks e
inspecionar. `projectId` e o host do GraphQL aparecem no HTML da home.

---

## Decisões de arquitetura (e por quê)

**O scanner roda LOCAL; Supabase é banco, não executor.** Cada jogo custa
~900 KB, dos quais só 18,5 KB são 1X2 — 98% é desperdício e não dá para filtrar
no servidor (persisted query). São ~2,5 GB/dia na janela 7. A cota grátis de
egress do Supabase (5 GB/**mês**) morreria em menos de um dia. Do que baixa,
**112 bytes** viram registro: proporção de 1 para 8.000.

**O ROI reportado é sempre pós-arredondamento.** Casas não aceitam R$ 33,333.
Arbitragem real medida: margem teórica −0,13% virou **R$ 0,16** em R$ 1.000
depois de arredondar para reais inteiros — o arredondamento comeu 87% do lucro.
Alertar o ROI teórico faria o usuário correr atrás de centavos.

**`bestLine` exige três casas distintas.** Se a mesma casa tem as duas melhores
odds, não é arbitragem — é uma casa generosa. Testa combinações (top-6 por
resultado) e fica com o menor S, porque a escolha gulosa perderia oportunidade
quando há colisão.

**`lucroMinimoPct` aceita negativo de propósito.** Arbitragem 1X2 é rara; com
limiar 0 o usuário pode passar dias em silêncio e não distinguir "não apareceu"
de "quebrou". Negativo = modo calibração, mostra quase-arbs (marcados 🟡).

**Dedupe é por família de alerta, não por chave imutável.** `dedupeKey` monta a
família (jogo + trio de casas); `arb_alerts.dedupe_key` grava `família@n`, uma
linha **por mensagem enviada**, para que cada uma tenha seu próprio botão de
feedback. Quem decide repetir é `mereceRealerta`, contra o **melhor** alerta já
enviado daquela família — não contra o último, senão um vai-e-volta mandaria
mensagem a cada volta. Duas portas: cruzou para arbitragem real (`isArb`), ou
melhorou `DEGRAU_REALERTA_PP` = 0,5 p.p. de ROI.

Motivo: com o `UNIQUE` calando para sempre, em 04/08/2026 o jogo `r9z6gEre`
alertou a −0,32%, e nos 40 min seguintes ficou oscilando entre −0,32% e −0,10%
**no mesmo trio**, em silêncio. Nesse caso não custou dinheiro (nenhuma passou
de 🟡), mas o mesmo silêncio engoliria um quase-arb que virasse arbitragem de
verdade — a única mensagem que o robô existe para mandar. **Silêncio longo do
bot costuma ser dedupe, não defeito**: confira `line_scans` antes de suspeitar
do Telegram.

**Cadência escalonada** (`intervaloMinutos`): >24h → 2h · 6-24h → 30min ·
2-6h → 10min · <2h → 2min. A faixa de 24h+ é o que torna janela larga barata:
13× mais jogos custam só 2,5× mais banda.

**`line_scans` grava toda varredura, mesmo sem arbitragem.** É o que responde
"quão perto chegamos" e se vale arriscar dinheiro. ~112 bytes/linha, limpeza de
30 dias. `arb_alerts` nunca é apagado.

**Botões de feedback no Telegram são a peça mais importante.** `✅ odd estava lá`
/ `❌ já sumiu` gravam em `arb_alerts.confirmed` e medem **o atraso real do
Flashscore** — o risco nº 1 do projeto, impossível de estimar sem medir.

**Proteção de rate limit**: 4 requisições simultâneas + 150 ms (~4,8 req/s
medidos), teto de 30 jogos/ciclo (espalha rajada), e **disjuntor global** que
para tudo por ≥5 min em `429`/`403` respeitando `Retry-After`. Não há retentativa
nesses códigos — insistir em rate limit é o que vira bloqueio de IP.

---

## Odds diretas — segundo sistema, independente

São **dois pipelines paralelos**, não um `if`. `settings.fonteDeOdds` escolhe:
`flashscore` (padrão, `src/arb/scanner.ts`) · `direto`
(`src/odds/scanner-direto.ts`) · `ambos`. Valor inválido cai em `flashscore` via
`z.enum().catch()` — dedo errado no painel não pode parar o robô.

Independência é **por construção**: `src/arb/*`, `src/flashscore/*` e
`src/telegram/*` não são importados em modo `direto` (o tipo compartilhado entra
por `import type`, apagado na compilação). O cliente HTTP é separado
(`src/http/client.ts`, com **disjuntor por host** — um 429 da Betano não pode
calar a Superbet). O que os dois compartilham de propósito é `src/arb/calc.ts`:
a matemática precisa ser a mesma para o modo `ambos` medir alguma coisa.

**A coleta inverte: por casa e por dia, não por jogo.** Uma requisição da
Superbet devolveu 257 jogos (~2,3 KB/jogo) contra 900 KB/jogo do Flashscore. O
custo vira `casas × dias`, sem depender de quantos jogos há — puxar direto é
**mais barato**, não mais caro. Por isso a cadência muda de papel: no direto ela
limita a **gravação** de `line_scans`, não a busca (que já veio inteira), e todo
jogo é avaliado em todo ciclo.

**Config é linha de banco, não arquivo.** `bookmaker_configs` (jsonb) é a fonte
da verdade, lida a cada ciclo; `src/odds/casas/*.json` são semente e alvo dos
testes. Validação zod em `src/odds/esquema.ts` acontece na **leitura**: config
inválida tira aquela casa do ciclo, com log, sem derrubar a varredura. Isso é
requisito, não zelo — um painel escreve direto no banco.

**Pareamento é o risco nº 1, não o scraping.** `src/odds/pareamento.ts` é puro e
recusa na dúvida: exige acerto nos **dois** times, margem sobre o 2º colocado
(empate técnico = recusa) e janela de kickoff. Atalho exato por `betradarId`,
que 97% dos jogos da Superbet trazem. Sufixos `II`/`B`/`U21` são **preservados** na
normalização — apagá-los fundiria time principal com reserva.

**Altenar cobre 9 casas com um adaptador** (`src/odds/casas/altenar.ts`):
BateuBet, BR4Bet, Brasildasorte, Esportivabet, F12, Goldebet, Jogo de Ouro,
Lotogreen, LuvaBet. Muda só o `integration` (`bateu`, `br4bet`, `brasildasorte`,
`esportiva`, `f12`, `goldebet`, `jogodeouro`, `lotogreen`, `luvabet`) — os nomes
foram **validados contra a API**, não deduzidos do domínio: `f12bet`, `luva` e
`lotogreenbet` dão 400.

Endpoint: `sb2frontend-altenar2.biahosted.com/api/widget/GetEvents`,
`sportId=66`, mercado `typeId=1` ("Vencedor do encontro"), cotações
`typeId` 1/2/3 = casa/empate/fora (o próprio `headers` da resposta documenta
isso), `oddStatus=0` = valendo.

Não cabe no motor declarativo: a resposta é **relacional** (`events`, `markets`,
`odds`, `competitors` em arrays ligados por id), então extrair exige junção.
É o caso que justifica o adaptador TS.

- **`champIds` derruba o payload de ~2,7 MB para ~52 KB**, e é a diferença entre
  viável e inviável (9 casas × 2,7 MB = 24 MB/ciclo). Filtros de data **não
  funcionam** (`dateFrom`/`dateTo`, `startDate`/`endDate`, `period` são ignorados):
  a resposta traz todas as datas, então o adaptador busca uma vez por ciclo e
  fatia por dia em memória.
- **O filtro só entra quando toda liga da janela já está mapeada naquela casa.**
  Sem essa condição, pedir só o conhecido impediria descobrir liga nova — ela
  nunca viria no payload, nunca seria pareada, e o robô ficaria cego para ela em
  silêncio.
- **Trava contra inversão**: há duas fontes independentes de quem é o mandante
  (`event.competitorIds[0]` e o `competitorId` da cotação tipo 1). Discordando, o
  jogo é descartado. É a checagem que faltava do lado do Flashscore.

**Liga sai de graça, derivada dos jogos já pareados** (`derivarCompeticoes`).
A Superbet não publica catálogo de torneios (`/tournaments`, `/categories`: 404),
então parear por nome ali seria impossível — mas jogo pareado revela a liga. Usa
o sinal mais forte e funciona em qualquer casa. `parearCompeticao` (contenção de
tokens, não Dice) fica para as casas que só buscam por liga: Dice não vê a
diferença entre "Série A" e "Série B", que é a única que importa.

## Contrato de curadoria — NUNCA violar

Estas colunas são do usuário e **nenhum upsert automático pode tocá-las**:

- `competitions.enabled`
- `bookmakers.has_account`, `bookmakers.max_stake`, `bookmakers.note`,
  `bookmakers.url`
- `bookmaker_competitions.manual`, `bookmaker_events.manual` — correção manual de
  pareamento é curadoria igual às outras; sem isso o usuário consertaria a liga
  hoje e ela voltaria errada amanhã
- `bookmaker_configs` e `bookmaker_auth` **inteiras** — o robô só lê

O upsert de competições atualiza só `name`/`url_path`/`last_seen_at`. Um sync que
sobrescrevesse `enabled` apagaria a configuração inteira em silêncio.

O contrato é **dado, não comentário**: `COLUNAS_CURADAS` e `COLUNAS_DO_SYNC` em
`src/db/repo.ts`, com as linhas montadas por `linhasDeCompeticoes`/`linhasDeCasas`
(puras, sem I/O, justamente para poderem ser inspecionadas). `src/db/repo.test.ts`
confere as chaves e simula o sync rodando 2× sobre base curada. Verificado que
falha de verdade: acrescentar `url` ao upsert derruba 3 testes. Se mexer no
upsert, rode.

O usuário gerencia ligas e casas **pelo painel do Supabase (SQL)**, não pelo
Telegram — foi escolha dele. O bot não tem comandos de curadoria.

**RLS**: habilitado em todas as tabelas **sem nenhuma policy** (nega tudo). O bot
usa `service_role`, que ignora RLS. O linter reporta `rls_enabled_no_policy`
nível INFO — é o desenho pretendido, não um problema. Views usam
`security_invoker = true` para não furarem o "nega tudo".

---

## Armadilhas já encontradas

- **Mandante e visitante vinham trocados** (corrigido em 12/08/2026). O parser
  assumia que o 1º `eventParticipantId` do payload era o mandante; é o visitante.
  **O bug se escondia porque o ROI continuava certo**: `S` é a soma dos três
  máximos, e trocar dois rótulos não muda a soma — `bestLine`, margem e alerta de
  arbitragem seguiam corretos. Só o *rótulo* mentia, mandando apostar no mandante
  pelo preço do visitante, o que mataria a arbitragem na execução.
  Descoberto ao comparar com a odd direta da Superbet: 19 de 19 jogos com empate
  idêntico e casa/fora trocados. Travado por teste que confere a regra contra o
  payload, não só os números (`src/flashscore/parsers.test.ts`).
  **Lição: métrica agregada certa não prova rótulo certo.**
- **`bestLine` precisa de 3 casas distintas** — abaixo disso o sistema direto é
  sempre silencioso, por aritmética, não por defeito. Virar `fonteDeOdds` para
  `direto` com menos de 3 adaptadores cala o robô.
- **`Invoke-WebRequest` do PowerShell decodifica como Latin-1** quando o servidor
  não declara charset. Gravar `.Content` como UTF-8 corrompe o fixture (`·` vira
  `Â·`). Use `-OutFile`, que grava os bytes crus.
- **`AE` é opcional no feed.** ~2% dos jogos trazem o mandante só em `CX`.
  Exigir `AE` descartava jogos em silêncio — e jogo descartado é arbitragem
  perdida sem aviso. Há teste travando isso.
- **`answerCallbackQuery` expira em ~15s** e é puramente cosmética. Precisa ficar
  em try/catch: quando falhava, abortava o handler e os botões ficavam girando
  na tela do usuário.
- **Botões do Telegram só funcionam com o robô rodando** (é polling). Por isso
  `test:telegram` fica escutando 90s em vez de mandar e sair.
- **`npx tsx -e "..."` inline pode sair antes de a requisição HTTP completar** —
  um `update` no Supabase não persistiu assim. Escreva um arquivo `.ts`.
- **`TaskStop`/fechar a janela não mata os processos node filhos.** Ctrl+C sim.
  Verificar sobras: `Get-CimInstance Win32_Process -Filter "Name like '%node%'"`.

---

## Convenções

- **Identificadores e comentários em português, sem acentos** (`varrer`,
  `melhorLinha`, `// nao retentar`). Textos de UI (README, Telegram) usam
  acentuação normal.
- Comentários explicam **por quê**, não o quê. Preferir comentar decisão não
  óbvia a narrar código.
- `src/arb/calc.ts` é funções puras, sem I/O — é onde um bug custa dinheiro.
  Toda mudança ali precisa de teste.
- Testes de parser rodam contra `fixtures/` (capturas reais do Flashscore).
  Não substituir por mocks sintéticos: é o que detecta mudança de formato.
- Migrations aplicadas via MCP `apply_migration`, espelhadas em
  `supabase/migrations/` para versionamento.

---

## Estado atual

Projeto Supabase **ARB**: `fkahtqqlznhrwkenenve` (org Ortolani, us-west-2).

`settings` (todas lidas a cada ciclo, mudança vale na hora):

| chave | valor | o que é |
|---|---|---|
| `banca` | 1000 | total distribuído entre as 3 apostas |
| `lucroMinimoPct` | 0 | limiar do alerta, pós-arredondamento (só arbitragem real) |
| `incrementoStake` | 1 | arredondamento do stake em R$ |
| `janelaDias` | 1 | 0 = só hoje · máx 7 |
| `minutosAntesDoInicio` | 5 | para de varrer N min antes do apito |
| `somenteCasasComConta` | false | ainda não filtrado — 0 casas marcadas |
| `pausado` | false | |
| `fonteDeOdds` | flashscore | `flashscore` · `direto` · `ambos` |

**Sondagem das 27 casas** (12/08/2026, do Brasil — `docs/casas-sondagem.md`):
19 abertas · 1 portão próprio (Betano, "Splash Screen") · 3 desafio JS
(1xBet, KTO, Novibet — `cf-mitigated: challenge`, resolvível por `cf_clearance`)
· 2 negadas em WAF (bet365, Betboom). **9 casas rodam em Altenar** (BateuBet,
BR4Bet, Brasildasorte, Esportivabet, F12, Goldebet, Jogo de Ouro, Lotogreen,
LuvaBet) — um adaptador cobre as nove, é o maior ganho por hora disponível.
Headers de navegador **não** vencem o bloqueio (testado): é fingerprint de
TLS/HTTP2.

**10 casas com adaptador**: Superbet (declarativa) + as 9 do Altenar. Medido em
`scan:direto`: 12 jogos com odds, quase todos com as 10 casas, margens de 5,3% a
8,5% — nenhuma arbitragem, coerente com o baseline.

**Divergência medida Flashscore × Superbet direta**: 18 jogos, 54 pernas,
diferença média **0,000**, pior desvio **0,0%** — depois de corrigir a inversão
mandante/visitante. Ou seja, o "não bate com o site" era o bug de rótulo, não
atraso do agregador. O modo `ambos` existe para continuar medindo isso.

387 competições no catálogo, **20 habilitadas** (lista definida pelo usuário:
UCL/UEL/UECL, Premier League, LaLiga, Bundesliga I e II, Eredivisie, MLS,
Ligue 1, Superliga DIN, Eliteserien, Allsvenskan, Superliga SUI, Serie A,
Liga Portugal, Brasileirão, Premiership ESC, Bundesliga AUT, Jupiler).
25 casas conhecidas, nenhuma marcada com `has_account`. Todas com `url`
preenchida a partir da planilha oficial da SPA/MF — casa autorizada é obrigada a
usar `.bet.br` (IN SPA/MF nº 11/2024), então domínio `.com` de casa brasileira é
redirect ou clone. O alerta do Telegram usa esse link.

Rodando em **Railway**. Settings e curadoria valem no ciclo seguinte sem
restart; só variáveis de ambiente e constantes de código (`REDE`,
`RETENCAO_DIAS`, `INTERVALO_CICLO_MS`) exigem redeploy. **Não rodar
`test:telegram` local com o Railway de pé**: dois pollers no mesmo token brigam
por `getUpdates` e o Telegram devolve 409.

**Baseline empírico**: numa amostra com 24 casas, o juice individual ia de 4,9%
a 10,3%; a melhor linha combinada fechou em 1,89% — perto, mas sem arbitragem.
Em 24 varreduras reais, **uma** ficou negativa (−0,13%). Arbitragem 1X2 existe,
mas é rara e magra. Não prometer o contrário ao usuário.

---

## Riscos que o robô não resolve

Ao falar com o usuário, não minimizar estes:

1. **Odds do Flashscore são agregadas e chegam com atraso.** Arb detectado pode
   já ter morrido. Sempre conferir na casa antes de apostar.
2. **Perna órfã**: fechar 2 de 3 apostas e a 3ª odd cair deixa exposto.
3. **Limitação de conta**: casas identificam arbitradores e cortam stake máximo.
   É o motivo nº 1 de a estratégia não escalar — mais que a falta de arbs.
4. **Stake máximo**: a casa com a melhor odd costuma aceitar menos dinheiro.
5. **Endpoints não oficiais** podem quebrar sem aviso.
