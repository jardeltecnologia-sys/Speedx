# 🧠 SPEEDX — PLANO MESTRE
### O cérebro na VPS, os aplicativos no bolso do planeta

> Documento oficial de arquitetura e funcionalidades, baseado em pesquisa profunda
> sobre a Uber (arquitetura real de despacho e apps), a 99 (líder no Brasil) e as
> melhores práticas de plataformas de mobilidade. Atualizado em: 04/07/2026.

---

## 1. A ESTRATÉGIA EM UMA FRASE

**Um cérebro central na VPS Hostinger** (backend + banco + página institucional) que
alimenta **três frentes**: o app do Passageiro, o app do Motorista (PWA + APK) e o
**Painel Admin** — crescendo por fases, cada fase 100% funcional e testada.

### O que a pesquisa revelou sobre PWA vs APK (decisão estratégica)

| Situação | Melhor escolha | Por quê |
|---|---|---|
| **Passageiro** | PWA serve muito bem + APK opcional | Ele usa o app com a tela ABERTA; PWA no Android tem push e instala do site |
| **Motorista** | **APK obrigatório** | Rastreamento de GPS em SEGUNDO PLANO e chamados com o celular no bolso **exigem app nativo** (PWA não faz isso de forma confiável) |
| **iPhone** | PWA limitado | Push em PWA no iOS é fraco; no futuro, versão iOS via Capacitor |

**Conclusão:** nossa arquitetura atual (mesmo código web → PWA + Capacitor/APK) é
exatamente a certa. O APK do motorista ganhará **localização em segundo plano +
serviço em primeiro plano (foreground service)** — é isso que o diferencia do PWA.

---

## 2. O CÉREBRO — ARQUITETURA DO BACKEND NA VPS

### 2.1 Como a Uber faz (o que aprendemos)

- **Índice geoespacial H3**: a Uber divide o mundo em hexágonos (biblioteca
  open-source `h3`, resoluções 7–9). Achar motoristas = olhar ~7 células vizinhas
  em vez de comparar milhões de pontos. *Nosso equivalente atual*: Redis GEO
  (GEOSEARCH), que resolve perfeitamente até dezenas de milhares de motoristas.
  **Migração para H3 só quando escalarmos para múltiplas cidades grandes.**
- **Despacho (dispatch)**: candidatos vêm do índice espacial → ranking por ETA e
  justiça (fairness) → oferta com prazo → recusa/timeout → reoferta ao próximo.
  *Já implementamos esse ciclo!* Evoluções: ranking por nota/taxa de aceitação,
  ETA real por rota (não linha reta), backoff e ofertas em lote.
- **Tempo real**: GPS de milhões de motoristas → memória (Redis), nunca disco.
  *Já fazemos.* Evolução: histórico de trajetos em lote para o PostgreSQL.
- **Particionamento geográfico**: uma "cidade" é a unidade de operação (zonas,
  preços e regras por cidade).

### 2.2 Módulos do cérebro (mapa completo)

| # | Módulo | O que faz | Status |
|---|--------|-----------|--------|
| 1 | **Despacho** | Fila por distância, oferta 20s, recusa→próximo | ✅ v1 pronta |
| 2 | **Posições em tempo real** | Redis GEO + Socket.io | ✅ v1 pronta |
| 3 | **Autenticação** | Cadastro/login (telefone + SMS/WhatsApp OTP), JWT, bcrypt, sessões, anti-fraude básico | 🔜 Fase 2 |
| 4 | **Perfis e KYC** | Documentos do motorista (CNH, CRLV, foto), aprovação pelo admin, selo verificado | 🔜 Fase 2/3 |
| 5 | **Ciclo de corrida persistente** | Máquina de estados no PostgreSQL (solicitada→aceita→chegou→em andamento→finalizada/cancelada), histórico, recibos | 🔜 Fase 3 |
| 6 | **Preços e tarifas** | Tarifa por cidade/categoria, preço dinâmico (surge) por zona quando demanda > oferta, taxa de cancelamento | 🔜 Fase 4 |
| 7 | **Pagamentos** | Pix (essencial no Brasil — a 99 adotou para cortar custo de maquininha), dinheiro, cartão depois; carteira do motorista com repasse | 🔜 Fase 4 |
| 8 | **Ledger financeiro** | Livro-razão de cada centavo: valor da corrida, comissão da plataforma, saldo do motorista, saques | 🔜 Fase 4 |
| 9 | **Avaliações** | Nota bilateral (passageiro↔motorista), comentários, média no perfil, remoção por nota baixa | 🔜 Fase 5 |
| 10 | **Notificações** | FCM push (chamados com app fechado!), SMS de backup, e-mail de recibo | 🔜 Fase 5 |
| 11 | **Segurança da viagem** | Compartilhar viagem ao vivo, botão de emergência, PIN de embarque, detecção de desvio de rota (RideCheck da Uber / Athena da 99) | 🔜 Fase 6 |
| 12 | **Rotas e ETA reais** | OSRM (Open Source Routing Machine) self-hosted na VPS: rota de verdade, tempo estimado, preço por km rodado real | 🔜 Fase 6 |
| 13 | **Promoções** | Cupons, indicação premiada (referral), clube de vantagens | 🔜 Fase 7 |
| 14 | **Incentivos ao motorista** | Metas/Quests ("complete X corridas, ganhe Y"), mapa de calor de demanda, modo destino | 🔜 Fase 7 |
| 15 | **Painel Admin** | Ver §5 | 🔜 Fase 5+ |
| 16 | **Suporte** | Tickets, chat de ajuda, central de disputas | 🔜 Fase 8 |
| 17 | **Auditoria e LGPD** | Logs de acesso, consentimento, exportação/apagamento de dados | contínuo |

### 2.3 Banco de dados PostgreSQL — o esquema completo (alvo)

```
usuarios            (já existe) + verificado, nota_media, foto_url, fcm_token
motoristas_detalhes (já existe) + status_kyc, categoria_veiculo, cidade_id
veiculos            (novo)  motorista pode ter mais de um carro
corridas            (já existe) + pin_embarque, rota_polyline, surge_multiplicador
corrida_eventos     (novo)  linha do tempo de cada corrida (auditoria)
posicoes_historico  (novo)  trilha GPS das corridas (segurança/disputas)
pagamentos          (novo)  método, status, id externo (Pix), valor, comissão
carteiras           (novo)  saldo do motorista
carteira_lancamentos(novo)  o ledger: cada crédito/débito imutável
avaliacoes          (novo)  de quem, para quem, nota, comentário, corrida
cidades / zonas     (novo)  polígonos de operação, tarifa por zona
tarifas             (novo)  base, por km, por minuto, mínima, por categoria
cupons / indicacoes (novo)  promoções e referral
documentos_kyc      (novo)  arquivos enviados + status de aprovação
tickets_suporte     (novo)  atendimento
```

**Redis (tempo real)**: posições GEO ✅, corridas ativas (migrar da RAM do Node
para Redis — sobrevive a restart), filas de oferta, contadores de surge por zona,
tokens de sessão.

### 2.4 Ecossistema da VPS (infraestrutura)

```
Internet → Cloudflare (DNS + proteção) → VPS Hostinger
  └── Nginx (proxy reverso + HTTPS Let's Encrypt + gzip)
        ├── speedx.dominio.com.br  → container backend (Node/Socket.io)
        ├── /passageiro /motorista → mesmos apps (PWA)
        └── /admin                 → painel administrativo
  ├── PostgreSQL 16 (container, volume persistente, backup diário → object storage)
  ├── Redis 7 (container, appendonly)
  ├── OSRM (container de rotas — Fase 6)
  └── Monitoramento: healthchecks + Uptime Kuma + logs rotacionados
```

- **Backups**: dump diário do PostgreSQL + retenção 30 dias (regra 3-2-1).
- **Segurança**: HTTPS obrigatório, JWT curto + refresh, rate limiting nas rotas
  de login, CORS restrito ao domínio, senhas bcrypt, secrets fora do Git ✅.
- **Escala futura**: hoje 1 VPS aguenta milhares de corridas/dia; o desenho por
  módulos permite depois separar despacho/pagamentos em serviços próprios.

---

## 3. APP DO PASSAGEIRO — paridade Uber/99

Legenda: ✅ pronto | 🎯 essencial p/ lançar | ⭐ diferencial competitivo

| Funcionalidade | Referência | Prioridade |
|---|---|---|
| Mapa com motoristas ao vivo | Uber | ✅ |
| Destino no toque + preço estimado antes | Uber ("fare transparency") | ✅ v1 (evoluir p/ busca de endereço) |
| Pedir/cancelar corrida, acompanhar chegada | Uber | ✅ |
| **Busca de endereço com autocompletar** (Nominatim/Photon self-hosted) | Uber | 🎯 |
| **Cadastro/login por telefone (OTP)** | Uber/99 | 🎯 |
| **Foto, nome, placa e nota do motorista ao aceitar** | Uber | 🎯 |
| **Acompanhamento da rota do motorista até mim (ETA)** | Uber | 🎯 |
| **Histórico de corridas + recibos** | Uber | 🎯 |
| **Pagamento: dinheiro + Pix** (cartão depois) | 99 (Pix nativo) | 🎯 |
| **Compartilhar viagem ao vivo com contatos** | Uber ShareMyTrip / 99 | 🎯 |
| **Botão de emergência (190/192) + dados da viagem** | Uber Safety Toolkit | 🎯 |
| Avaliar motorista (+ gorjeta) | Uber | 🎯 |
| **PIN de embarque de 4 dígitos** ("é o carro certo?") | Uber PIN verification | ⭐ |
| **RideCheck: detectar desvio de rota/parada estranha** | Uber / Athena (99) | ⭐ |
| Corrida agendada | Uber | ⭐ |
| Lugares salvos (casa/trabalho) | Uber | ⭐ |
| Cupons e indicação premiada | 99 Clube | ⭐ |
| Categorias (SpeedX, SpeedX Moto, SpeedX Comfort) | Uber/99 | ⭐ |
| Preferência por motoristas mulheres (passageiras) | Pítia (99) | ⭐ |
| Selo "passageiro verificado" | Uber rider verification | ⭐ |

## 4. APP DO MOTORISTA — paridade Uber/99

| Funcionalidade | Referência | Prioridade |
|---|---|---|
| Ficar online/offline com um toque | Uber | ✅ |
| Chamado com valor, distâncias e prazo de 20s | Uber ("trip acceptance controls") | ✅ |
| Aceitar/recusar sem punição escondida | Uber | ✅ |
| **GPS em segundo plano + serviço em 1º plano** (celular no bolso) | obrigatório nativo | 🎯 |
| **Push FCM do chamado com app fechado + som alto** | Uber | 🎯 |
| **Cadastro com documentos (CNH, CRLV, selfie) e aprovação** | Uber/99 KYC | 🎯 |
| **Painel de ganhos em tempo real (dia/semana/mês)** | Uber earnings tracker | 🎯 |
| **Carteira + repasse via Pix** ("mesmo dia", como o Cartão99) | 99 | 🎯 |
| **Navegar até o passageiro (abrir Waze/Google Maps)** | Uber | 🎯 |
| Botões "Cheguei" → "Iniciar viagem" → "Finalizar" | Uber | 🎯 |
| Avaliar passageiro | Uber | 🎯 |
| Histórico de corridas e extrato | Uber | 🎯 |
| **Mapa de calor de demanda** | Uber heatmap | ⭐ |
| **Metas/Quests** ("30 corridas na semana = bônus") | Uber Quests | ⭐ |
| **Modo destino** (2x/dia, corridas no caminho de casa) | Uber Destination Mode | ⭐ |
| Kit de segurança (emergência, compartilhar, gravação) | Uber Safety Toolkit | ⭐ |
| Filtros de corrida (distância máxima, só Pix...) | 99 | ⭐ |

## 5. PAINEL ADMIN — o rosto do cérebro (Fase 5+)

- **Mapa ao vivo da frota** (todos os carros, corridas em andamento)
- **Aprovação de motoristas**: fila de documentos KYC com aprovar/reprovar
- **Gestão de usuários**: buscar, suspender, banir, ver histórico
- **Preços**: tarifas por cidade/categoria/zona, ligar/desligar surge, taxas
- **Financeiro**: receita, comissões, repasses pendentes, relatórios CSV/PDF
- **Disputas e suporte**: tickets, reembolsos, central de incidentes
- **Métricas**: corridas/dia, tempo médio de espera, taxa de aceitação, avaliações

## 6. ROTEIRO OFICIAL DE FASES (corte estratégico definido em 04/07/2026)

| Fase | Entrega | Marco comercial |
|------|---------|-----------------|
| ✅ 1 | Backend tempo real + geobusca | — |
| ✅ Apps | PWA + APKs + página institucional + chamado v1 | Demonstração |
| ✅ **2** | **Sistema no ar**: VPS + Docker + Nginx + HTTPS + speedx.titanhost.cloud | **Presença pública**: recrutar motoristas, parcerias, lista de espera, validar demanda |
| **3** | **Identidade + corridas reais**: conta com telefone validado, JWT/bcrypt, corrida gravada no PostgreSQL com estados completos (cheguei → iniciar → finalizar), histórico, foto/placa/nota do motorista | **Receita piloto**: operação controlada em Teotônio Vilela — poucos motoristas, área limitada, suporte manual, cobrança simples |
| **4** | **Pix + carteira + ledger**: repasse ao motorista, taxa da plataforma, estorno, comprovante, livro-caixa imutável | **Receita de verdade**: cobrança automática — o Speedx vira negócio |
| **5** | **APK motorista robusto + admin**: GPS em segundo plano, push FCM, avaliações, Painel Admin (KYC, frota ao vivo, tarifas, bloqueios, relatórios) | **Escala**: de "app que funciona" para empresa operável |
| **6** | **Compliance e expansão**: segurança (PIN, RideCheck, emergência, compartilhar viagem), OSRM (rotas/ETA reais), antifraude, suporte/tickets, auditoria | Operação madura e expansão regional |
| 7+ | Surge por zona, heatmap, quests, modo destino, cupons/indicação, iOS | Paridade total de mercado |

### 6.1 Marcos de receita (a régua honesta)

1. **Agora (pós-Fase 2)** — receita indireta e pré-operacional: parcerias, patrocínio
   local, pré-cadastro, contratos B2B. Ainda **não** é operação de transporte madura.
2. **Pós-Fase 3** — piloto fechado com cobrança simples (taxa manual, mensalidade
   simbólica de motorista, comissão controlada).
3. **Pós-Fase 4** — primeiro marco de receita operacional séria: cobrança automática.
4. **Pós-Fase 5** — ecossistema quase autoadministrável; hora de escalar.

## 6.2 CONFORMIDADE LEGAL (Brasil) — nasce junto com o código

- **Lei 13.640/2018** (Política Nacional de Mobilidade Urbana): a regulamentação e
  fiscalização do transporte remunerado privado individual por aplicativo é
  **competência municipal**. → Antes do lançamento comercial, validar a regra do
  município de Teotônio Vilela/AL (e de cada cidade de expansão).
- **Motoristas**: exigir CNH categoria B ou superior **com EAR** (Exerce Atividade
  Remunerada) no cadastro/KYC — verificação obrigatória na Fase 5 (aprovação de
  documentos no Painel Admin).
- **LGPD (Lei 13.709/2018)**: o Speedx trata telefone, localização, documentos,
  corridas e pagamentos. Obrigações desde a Fase 3:
  - Política de privacidade pública no site e nos apps
  - Consentimento explícito no cadastro
  - Coleta mínima (só o necessário para a corrida)
  - Direito de exportar e apagar os dados (rotas de autoatendimento)
  - Logs de acesso a dados pessoais (trilha de auditoria)
  - Retenção definida: trilhas GPS e documentos com prazo e propósito claros

> **Mentalidade oficial do projeto:** a meta não é "ter um app tipo Uber" — é ter
> um **sistema de mobilidade regional** com controle administrativo, financeiro,
> jurídico e operacional próprio. A Uber vence pela operação, não só pelo app.

---

## 7. REGRAS DE OURO (não esquecer nunca)

1. **O servidor manda no preço** — o app só exibe; nunca confiar no cliente.
2. **Posição = Redis; dinheiro e histórico = PostgreSQL** — cada dado na casa certa.
3. **Cada fase sai testada de ponta a ponta** antes da próxima começar.
4. **APK e web sempre em sincronia** (mesmo código, build na nuvem).
5. **Ledger imutável**: dinheiro nunca é editado, só recebe novos lançamentos.
6. **Segurança em camadas**: HTTPS, JWT, bcrypt, rate limit, LGPD.
