# ⚡ Speedx

Aplicativo de mobilidade urbana (estilo Uber) — nascido em **Teotônio Vilela/AL**, pronto para o mundo 🌍.

## Os dois aplicativos

| App | Cor | Para quem |
|---|---|---|
| 🟢 **Speedx Passageiro** | raio escuro no verde | quem pede a corrida |
| ⚫ **Speedx Motorista** | raio verde no escuro | quem dirige |

📲 **Baixar os APKs:** aba [Releases](../../releases) deste repositório.

## Arquitetura

- **backend/** — Node.js + Express + Socket.io (API REST + rastreamento em tempo real)
- **apps/passageiro** e **apps/motorista** — os aplicativos web (mesmo código dos APKs)
- **mobile/** — projetos Capacitor que empacotam os apps como APKs Android
- **db/init.sql** — estrutura do PostgreSQL (usuários, motoristas, corridas)
- **docker-compose.yml** — PostgreSQL 16 + Redis 7 (posições dos carros em tempo real)

## Rodar localmente

```bash
docker compose up -d      # sobe PostgreSQL e Redis
cd backend
npm install
npm run dev               # API em http://localhost:3000
```

- App do passageiro: `http://localhost:3000/passageiro`
- App do motorista: `http://localhost:3000/motorista`

## Gerar os APKs

Aba **Actions** → **Build APKs Speedx (Passageiro + Motorista)** → **Run workflow**.
Os dois APKs aparecem na aba **Releases** ao final (±5 minutos).

## Fases do projeto

- ✅ **Fase 1** — Backend: API, WebSocket, busca geoespacial (Redis GEO)
- ✅ **Fase Apps** — Apps web + APKs Android (Capacitor)
- 🔜 **Fase 2** — Nginx na VPS + autenticação (bcrypt/JWT)
- 🔜 **Fase 3** — Ciclo completo da corrida (pedido → aceite → viagem → fim)
- 🔜 **Fase 4** — Preço, Pix e histórico
