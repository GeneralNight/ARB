# Sondagem das casas

Gerado por `npm run sondar` · bordas Cloudflare: GRU

Classificacao de **acesso**, nao de qualidade das odds. Ordem = custo de
integracao crescente. Veja `src/odds/sondagem.ts` para o criterio.

| casa | acesso | plataforma | evidencia |
|---|---|---|---|
| [BateuBet](https://bateu.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Bet7k](https://7k.bet.br) | aberta | Sportradar | HTTP 200, plataforma Sportradar |
| [BetdaSorte](https://betdasorte.bet.br) | aberta | Digitain | HTTP 200, plataforma Digitain |
| [BetEsporte](https://betesporte.bet.br) | aberta | Sportradar | HTTP 200, plataforma Sportradar |
| [Betnacional](https://betnacional.bet.br) | aberta | — | HTTP 200, 603 KB |
| [BR4Bet](https://br4.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [BrasilBet](https://brasil.bet.br) | aberta | — | HTTP 200, 50 KB |
| [Brasildasorte](https://brasildasorte.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Casadeapostas](https://casadeapostas.bet.br) | aberta | — | HTTP 200, 284 KB |
| [Esportivabet](https://esportiva.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Estrelabet](https://estrelabet.bet.br) | aberta | Sportradar | HTTP 200, plataforma Sportradar |
| [F12](https://f12.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Galerabet](https://galera.bet.br) | aberta | Mitmegas | HTTP 200, plataforma Mitmegas |
| [Goldebet](https://goldebet.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Jogo de Ouro](https://jogodeouro.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [Lotogreen](https://lotogreen.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [LuvaBet](https://luva.bet.br) | aberta | Altenar | HTTP 200, plataforma Altenar |
| [SeguroBet](https://seguro.bet.br) | aberta | BetConstruct | HTTP 200, plataforma BetConstruct |
| [Superbet.br](https://superbet.bet.br) | aberta | — | HTTP 200, 6 KB |
| [Betano.br](https://betano.bet.br) | portao proprio | Kaizen | HTTP 403, pagina de 1649 bytes ("Betano Splash Screen") |
| [1xBet.br](https://1xbet.bet.br) | desafio JS | — | cf-mitigated: challenge — precisa de cf_clearance (porteiro) |
| [KTO.br](https://kto.bet.br) | desafio JS | — | cf-mitigated: challenge — precisa de cf_clearance (porteiro) |
| [Novibet](https://novibet.bet.br) | desafio JS | — | cf-mitigated: challenge — precisa de cf_clearance (porteiro) |
| [bet365](https://bet365.bet.br) | negada | — | HTTP 403, pagina de bloqueio do Cloudflare (WAF) |
| [Betboom.br](https://betboom.bet.br) | negada | — | HTTP 403, pagina de bloqueio do Cloudflare (WAF) |


## Sem URL cadastrada

- Betfair (id 429)
- Sportingbet.br (id 783)
