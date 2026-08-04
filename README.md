# ARB — detector de arbitragem 1X2

Lê as odds de ~24 casas no Flashscore, calcula se dá para apostar em Casa,
Empate e Fora em **três casas diferentes** e lucrar independente do resultado,
e avisa no Telegram com os valores já calculados.

**Não aposta sozinho.** O alerta é uma pista para você conferir na casa e
clicar — nunca uma ordem.

```
S = 1/odd_casa + 1/odd_empate + 1/odd_fora
S < 1  →  existe arbitragem
stake_i = total × (1/odd_i) / S      → retorno igual nos 3 cenários
```

---

## Instalação

```bash
npm install
cp .env.example .env      # e preencha
```

`.env`:

| Variável | Onde pegar |
|---|---|
| `SUPABASE_URL` | já preenchido: `https://fkahtqqlznhrwkenenve.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Painel → Project Settings → API Keys → `service_role` |
| `TELEGRAM_BOT_TOKEN` | crie um bot com [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | mande `/start` para [@userinfobot](https://t.me/userinfobot) |

A `service_role` ignora o RLS. Ela fica só neste processo local — nunca no
navegador, nunca commitada.

---

## Primeiros passos

```bash
npm run doctor              # os endpoints do Flashscore respondem?
npm run sync:competitions   # descobre ~380 competições (todas desligadas)
```

Depois, no **SQL Editor do Supabase**, escolha o que varrer:

```sql
select * from v_competitions_pick;      -- o catálogo inteiro

update competitions set enabled = true
where id in ('Yq4hUnzQ', 'vRtLP6rs', 'zFsJPnr6');
-- Yq4hUnzQ = Brasileirão Betano
-- vRtLP6rs = Brasileirão Série B
-- zFsJPnr6 = Copa Betano do Brasil

select id, name from competitions where enabled order by name;
```

E então:

```bash
npm run proximos            # jogos de hoje que ainda não começaram, por liga
npm run scan:once           # uma varredura, com o funil de filtragem impresso
npm start                   # o robô, em loop
```

`npm run proximos` é o atalho para escolher o que ligar: mostra onde ainda há
jogo hoje e marca com `✓` as ligas já habilitadas. `scan:once` é diagnóstico —
imprime e grava `line_scans`, mas **não** registra alerta nem manda Telegram;
quem faz isso é o `npm start`.

---

## Como o robô funciona

A cada minuto: lê o feed de **hoje** (~140 KB) → filtra pelas ligas habilitadas
→ descarta os jogos já iniciados → busca odds só do que sobrou.

Cadência escalonada pelo tempo até o apito, porque odds pré-jogo se mexem
devagar quando o jogo está longe:

| Falta para começar | Revarre a cada |
|---|---|
| mais de 6 h | 30 min |
| 6 h a 2 h | 10 min |
| menos de 2 h | 2 min |

Cada jogo custa ~900 KB de download, dos quais **98% é mercado que não usamos**
(Correct Score, handicaps, Over/Under). Não dá para filtrar no servidor: é
_persisted query_, o formato é fixo. É por isso que o robô roda local e não numa
função de nuvem — a cota grátis de banda do Supabase morreria em menos de um dia.

Do que ele baixa, quase nada vira registro: **900 KB baixados → 112 bytes
gravados** no Supabase por varredura. O banco nunca é o gargalo; a sua internet
pode ser.

### Proteção contra rate limit

A API não é oficial, então a postura é conservadora:

- **4 requisições simultâneas**, com 150 ms de pausa → ~4,8 req/s medidos
- **Teto de 30 jogos por ciclo.** O loop roda a cada minuto, então 150 jogos
  vencidos ao mesmo tempo viram ~5 min de trabalho suave em vez de uma rajada.
  Quem está mais perto do apito passa na frente.
- **Disjuntor global.** Um `429` ou `403` **para tudo** por no mínimo 5 minutos
  (ou o que o `Retry-After` mandar, o que for maior). Não há retentativa —
  insistir em cima de um rate limit é o que vira bloqueio de IP.

Quando o disjuntor está ativo, o log mostra
`pausado por rate limit — 280s restantes` e nenhuma requisição chega a sair.

Se quiser ser ainda mais conservador, mexa em `REDE` no `src/config.ts`.

---

## Curadoria (no painel do Supabase)

Estas colunas são suas. **Nenhum sync automático as sobrescreve** — o upsert
toca só em `name` e `last_seen_at`:

```sql
-- ligar por busca, excluindo base e feminino
update competitions set enabled = true
where name ilike '%Brasileir%'
  and name not ilike '%Sub-%'
  and name not ilike '%Feminino%';

-- marcar onde você tem conta E saldo
update bookmakers set has_account = true where id in (16, 574);
select id, name from bookmakers order by name;

-- passar a alertar só nas casas onde você consegue apostar
update settings set value = 'true' where key = 'somenteCasasComConta';

-- anotar o limite prático que a casa aceita de você
update bookmakers set max_stake = 200 where id = 16;
```

### Ligas fora de temporada

O catálogo do feed só enxerga **-1 a +7 dias** (de +8 em diante o feed devolve
vazio). Liga em pré-temporada — Premier League em agosto, por exemplo —
simplesmente não aparece lá. Para essas, use a busca, que enxerga o ano inteiro
e devolve **os mesmos IDs** que o feed usa:

```bash
npm run buscar -- "premier league"                        # lista com país e id
npm run buscar -- "premier league" --habilitar Inglaterra # cadastra e liga
npm run add:liga -- dYlOSQOD "INGLATERRA: Premier League" # ou direto pelo id
```

A busca responde em português, então procure pelo nome em português
(`liga dos campeões`, não `champions league`).

O ID de uma competição **não muda entre fases**: `xGrwqq16` serve tanto para
"Liga dos Campeões - Qualificação" quanto para a fase principal. Habilitar uma
vez basta para a temporada inteira.

### Ligas habilitadas hoje

| ID | Competição |
|---|---|
| `xGrwqq16` | EUROPA: Liga dos Campeões |
| `ClDjv3V5` | EUROPA: Liga Europa |
| `GfRbsVWM` | EUROPA: Liga Conferência |
| `dYlOSQOD` | INGLATERRA: Premier League |
| `QVmLl54o` | ESPANHA: LaLiga |
| `W6BOzpK2` | ALEMANHA: Bundesliga |
| `tKH71vSe` | ALEMANHA: 2. Bundesliga |
| `Or1bBrWD` | PAÍSES BAIXOS: Eredivisie |
| `CQv5qrFt` | EUA: MLS |
| `KIShoMk3` | FRANÇA: Ligue 1 |
| `O6W7GIaF` | DINAMARCA: Superliga |
| `GOvB22xg` | NORUEGA: Eliteserien |
| `nXxWpLmT` | SUÉCIA: Allsvenskan |
| `KAjTCI1l` | SUÍÇA: Superliga |
| `COuk57Ci` | ITÁLIA: Serie A |
| `UmMRoGzp` | PORTUGAL: Liga Portugal |
| `Yq4hUnzQ` | BRASIL: Brasileirão Betano |
| `tGwiyvJ1` | ESCÓCIA: Premiership |
| `rJg7S7Me` | ÁUSTRIA: Bundesliga |
| `dG2SqPrf` | BÉLGICA: Liga Jupiler |

**Sobre escolher ligas**: ligas obscuras costumam gerar mais arbs — as casas
precificam com menos cuidado e discordam mais entre si — mas aceitam stakes bem
menores. Ligas grandes têm mais casas cobrindo e limites maiores, porém as odds
convergem. `line_scans.book_count` deixa você decidir isso com os seus dados.

---

## Limiar de alerta

O botão principal. Só apita quando o lucro garantido for ≥ X %:

```
/min 1.5      no Telegram
```
```sql
update settings set value = '1.5' where key = 'lucroMinimoPct';
```

Lido a cada ciclo, então muda na hora. O corte usa o ROI **depois do
arredondamento dos stakes**, não o teórico — alertar +0,5 % que na prática vira
+0,1 % é pior do que não alertar.

**Aceita valor negativo de propósito.** Arbitragem 1X2 é rara; com o limiar em
`0` você pode passar dias sem receber nada e não conseguir distinguir "não
apareceu oportunidade" de "o robô quebrou e não avisou". O padrão vem em `-1`
(modo calibração): ele apita também nos quase-arbs, você vê a coisa
funcionando, e depois sobe para o valor real.

---

## Vale a pena? (as duas queries que importam)

```sql
select * from v_arb_summary;    -- alertas por dia, ROI médio/máx, confirmações
select * from v_near_misses;    -- quão perto chegamos de uma arbitragem
```

`ainda_existiam` e `ja_tinham_sumido` vêm dos botões que você clica no alerta do
Telegram (`✅ odd estava lá` / `❌ já tinha sumido`). Depois de algumas dezenas
de alertas, essas duas colunas medem **o atraso real das odds do Flashscore** —
o maior risco do projeto, e o único jeito de saber é medindo.

Rode em observação alguns dias antes de apostar dinheiro.

---

## Comandos do Telegram

| Comando | O que faz |
|---|---|
| `/status` | configuração atual e quantas ligas estão ligadas |
| `/resumo` | desempenho dos últimos dias |
| `/banca 2000` | total a distribuir entre as 3 apostas |
| `/min 1.5` | limiar de alerta (aceita negativo) |
| `/pausar` `/retomar` | liga e desliga a varredura |

Ligas e casas são gerenciadas no painel do Supabase, não aqui.

---

## Quando o Flashscore quebrar

Os endpoints são internos, não são API pública. `npm run doctor` diz o que caiu.

**Valores atuais** (`src/flashscore/endpoints.ts`), verificados em 03/08/2026:

| | |
|---|---|
| `PROJECT_ID` | `401` (flashscore.com.br; o `.com` é `2`) |
| `FSIGN` | `SW9D1eZo` |
| `ODDS_HASH` | `oce` |
| Feed | `https://401.flashscore.ninja/401/x/feed/f_1_{dia}_3_pt-br_1` |
| Odds | `https://global.ds.lsapp.eu/pq_graphql?_hash=oce&eventId=…&projectId=401` |

### Redescobrir o `ODDS_HASH`

O endpoint é _persisted query_: só aceita hashes pré-registrados. Hash errado
responde `404 Query not stored` — e esse 404 é justamente o sinal.

Teste candidatos curtos direto:

```bash
for H in oce ope ocd dol odds; do
  printf "%-6s " "$H"
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Referer: https://www.flashscore.com.br/" \
    "https://global.ds.lsapp.eu/pq_graphql?_hash=$H&eventId=A9tzvkkC&projectId=401&geoIpCode=BR&geoIpSubdivisionCode=BRSP"
done
```

`200` = achou. Foi assim que `oce` apareceu.

### Redescobrir o resto

1. Baixe a home e ache o bundle: `runtime.<hash>.js` em `/res/_fs/build/`.
2. Nele há o mapa de chunks. Procure `oddsTab` e `OddsComparisonFsdsFeedParser`
   (eram `58922` e `59053`) para achar o nome do arquivo do chunk de odds.
3. Baixe esse chunk e inspecione — é lá que ficam `findOddsByEventId`,
   `getOddsComparisonFsdsFeed` e afins.
4. `PROJECT_ID` e o host do feed aparecem na própria home
   (`projectId":401`, `<link rel="preconnect" href="https://global.ds.lsapp.eu/pq_graphql">`).

O feed antigo `df_od_*` está morto — responde sempre `0`. Não perca tempo com ele.

---

## Testes

```bash
npm test          # 26 testes: núcleo matemático + parsers contra payload real
npm run typecheck
```

Os testes de parser rodam contra `fixtures/` — capturas reais do Flashscore.
Se o formato mudar, quebram aqui antes de quebrar em produção.

Vetores de referência no `calc.test.ts`:
- sem arb: `2.70 / 2.85 / 3.36` → `S = 1.01887` (medido em jogo real, 24 casas)
- com arb: `2.60 / 3.60 / 3.40` → `S = 0.95651`, ROI +4,55 %

---

## O que este robô não resolve

1. **As odds do Flashscore chegam com atraso.** Um arb detectado pode já ter
   morrido. Confira na casa antes de apostar — e use os botões de feedback, que
   existem para medir esse atraso em vez de supor.
2. **Perna órfã.** Se você fecha 2 das 3 apostas e a 3ª odd cai, fica exposto.
   Aposte da odd mais volátil para a mais estável.
3. **Limitação de conta.** Casas identificam arbitradores e cortam o stake
   máximo. É o motivo nº 1 de a estratégia não escalar — mais que a falta de arbs.
4. **Stake máximo.** A casa com a melhor odd costuma ser a que aceita menos
   dinheiro. Anote em `bookmakers.max_stake`.
