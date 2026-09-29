# Relatório — Bot WhatsApp TECNOINCUBADORA

> Data: 29/09/2026
> Estado: **deploy no ar e bot a responder.** O token que está a funcionar está
> gravado na BD (`tenants.token`), não no Vercel. Ver secção 0.

---

## 0. O QUE FAZER AGORA (ler primeiro)

### Se o bot estiver calado: o token expirou

Não é código. O webhook recebe a mensagem e grava na BD (clientes/sessões
actualizadas), mas o envio falha com `OAuthException 190 / subcode 463` e o erro
é engolido pelo `try/catch` — por isso "não acontece nada".

Confirma em 5 segundos pela BD: se `clientes.ultima_interacao` está a avançar e
`bot_sessoes.updated_at` não, o bot recebeu e **não** respondeu.

### Rotação rápida de token (SEGUNDOS, sem deploy)

O token vive em `tenants.token`. `src/services/metaApi.js:12` dá prioridade ao
token do tenant, logo o Vercel é irrelevante enquanto esta coluna estiver
preenchida. **Não é preciso `vercel deploy`.**

```sql
UPDATE tenants SET token = '<token novo>' WHERE id = 1;
```

Ou pelo painel `/admin` (a tabela `tenants` está entre as tabelas geridas).

Validar o token **antes** de gravar, para não gravar lixo:

```
GET https://graph.facebook.com/v20.0/1349279428267688
     ?fields=display_phone_number,verified_name
     &access_token=<token>
```

`display_phone_number: "+258 86 139 0985"` = token bom. E ver a validade:

```
GET /v20.0/debug_token?input_token=<token>   →  expires_at
```

### De onde copiar o token (importante: a duração varia)

| Origem | Duração | Prefixo |
|---|---|---|
| WhatsApp → **API Setup** → *Temporary access token* | **24h** | `EAAPepYGwfAkBSq…` |
| App Dashboard (token de developer) | **~1h** | `EAAPepYGwfAkBSm…` |

**Usa sempre o do API Setup.** O do App Dashboard morre em ~1 hora e apanha o
bot a meio do dia.

### Token permanente — a partir de ~4 de Outubro

A Meta recusa Admin System Users com menos de 7 dias:

> "The Admin System User must be at least 7 days old before creating other Admin System Users."

O system user `tecnoincubadora-bot` foi criado a 27/09/2026. Passados 7 dias
(≈**4 de Outubro**) faz-se o token com **Token expiration: Never** e grava-se
com o `UPDATE` acima. Acabou-se o tema.

Ao gerar o token permanente, confirmar que devolve `expires_at: 0`.

### O que NÃO fazer

- ❌ `vercel env add` + `vercel deploy` para cada token. Um deploy demora >5 min
  e o token temporário pode expirar a meio. A coluna `tenants.token` evita isso.
- ⚠️ Este repositório tem o `.vercel` local ligado ao projecto certo
  (`tecnoincubadora-admin-bots`). Confirma com `vercel link --project <nome>`
  antes de qualquer deploy, senão publicas na app errada.

---

## 1. Visão geral

Sistema de **assistente WhatsApp** para a TECNOINCUBADORA, construído como uma
**plataforma multi-tenant** — ou seja, o mesmo código serve:

1. o **bot da própria TECNOINCUBADORA** (tenant 1); e
2. uma **SaaS para criar bots** para outros negócios (cada cliente = um tenant).

- **Canal:** WhatsApp Business Cloud API (Meta) — rota oficial.
- **Backend:** Node.js + Express, publicado no Vercel.
- **Base de dados:** PostgreSQL (Neon), base `bots`.
- **Painel admin:** web, em `/admin`.

---

## 2. O que está FEITO

### 2.1 Canal WhatsApp (Meta)
- [x] App Meta `tecno_bot` criada, produto WhatsApp ativo, **Live (publicada)**
- [x] Número real **`+258 86 139 0985`** (TECNO_BOT) registado e verificado
- [x] Webhook configurado: `https://tecnoincubadora-admin-bots.vercel.app/webhook`
- [x] Campo **`messages`** subscrito e **app subscrita à WABA**
- [x] Assinatura HMAC (`APP_SECRET`) ativa
- [x] Bot **a responder no número real** (testado ponta a ponta)

### 2.2 Bot (fluxos e máquina de estados)
- [x] Menu principal com 5 opções
- [x] **Máquina de estados** persistida em `bot_sessoes` (campo `contexto` JSONB)
- [x] Opção **1 – Pedir cotação** (tipo + descrição → grava `cotacoes`)
- [x] Opção **2 – Ver planos/preços** (catálogo por tipo → escolher → contratar)
- [x] Opção **3 – Pagar licença** (lista licenças/pagamentos do cliente)
- [x] Opção **4 – Encomendar sistema/serviço** (`cotacoes` tipo `sistema_custom`)
- [x] Opção **5 – Falar com humano** (estado `humano` + log admin)
- [x] Nome do cliente gravado do perfil WhatsApp
- [x] Fluxo de contratação: escolher plano → cria `licencas` (pendente) +
  `pagamentos` (pendente) → escolher método (e-Mola / M-Pesa / Visa)

### 2.3 Catálogo (dados)
- [x] **12 SaaS**: Xonguile, Gymar, Adegahub, Shoplink, TurboIA, Cafe Point,
  GestorFarma, CrediHub, BrokersHub, Gamerz, Smart Warehouse WMS, SmartSchoolMZ
- [x] **1 bot**: Bot WhatsApp (Basic 3000/mês, Premium 5000/mês)
- [x] **Serviços**: Produção Audiovisual (vídeos, documentários, vídeo musical,
  publicidade, filmes/seriados), Design Gráfico (cartazes, logos),
  Sinalética Digital (digital boards), Formação em IA (AI Training)
- [x] Preços dos SaaS: **Basic 3900 · Premium 6300 · Enterprise 10200** (mensal)
- [x] Coluna `categoria` adicionada a `produtos`

### 2.4 Multi-tenant
- [x] Tabela `tenants` (nome, phone_number_id, waba_id, token, ativo, config)
- [x] `tenant_id` em todas as tabelas de negócio (com backfill para o tenant 1)
- [x] Webhook resolve o tenant pelo `phone_number_id`
- [x] Envio (`metaApi`) por tenant (token + número), com fallback para o ambiente
- [x] Queries de catálogo/sessões filtradas por tenant

### 2.5 Painel admin
- [x] Login por password (sessão por cookie HttpOnly, HMAC-SHA256)
- [x] CRUD genérico das tabelas, com validação (whitelist + introspecção)
- [x] Tabelas geridas: `tenants, clientes, produtos, planos, licencas, cotacoes,
  orcamentos, encomendas, pagamentos, bot_sessoes`

### 2.6 Infra / deploy
- [x] Deploy no Vercel (projecto `tecnoincubadora-admin-bots`)
- [x] `server.js` (local) + `api/index.js` + `vercel.json` (Vercel)
- [x] Páginas legais: `/privacy` e `/data-deletion` (exigidas pela Meta)

---

## 3. Identificadores de referência (NÃO contém segredos)

> Values confirmed against the database and the live deployment on 27/09/2026.
> The `PENDENTES.md` file contains **obsolete values from an older project**
> (`whatsappbot-gold`, app `wassppbot`) — do not use it as reference.

| Item | Valor |
|---|---|
| App Meta (bot) | `1089227356929033` (`tecno_bot`) |
| WABA (WhatsApp Business Account) | `1050705194450386` |
| Número real – phone_number_id | `1349279428267688` |
| Número real – telefone | `+258 86 139 0985` |
| Negócio verificado | `890088647173519` |
| Tenant TECNOINCUBADORA (BD) | `1` |
| Base de dados (Neon) | `ep-old-mountain-b5yvr8av`, base `bots` |
| URL do bot | `https://tecnoincubadora-admin-bots.vercel.app` |
| Webhook | `https://tecnoincubadora-admin-bots.vercel.app/webhook` |
| Painel admin | `https://tecnoincubadora-admin-bots.vercel.app/admin` |

> Segredos (`WHATSAPP_TOKEN`, `APP_SECRET`, `ADMIN_PASSWORD`, `DATABASE_URL`)
> estão **apenas** nas variáveis de ambiente do Vercel — nunca no repositório.

---

## 4. Ficheiros principais

```
whatsappbot/
├── server.js                 # arranque local
├── api/index.js              # entrada no Vercel
├── vercel.json               # rewrites
├── src/
│   ├── app.js                # app Express (webhook + admin + páginas legais)
│   ├── legal.js              # política de privacidade / eliminação de dados
│   ├── config/env.js         # variáveis de ambiente
│   ├── routes/
│   │   ├── webhook.js        # handshake + receção de mensagens (por tenant)
│   │   └── admin.js          # API do painel admin
│   ├── services/
│   │   ├── dbService.js      # pool, tenants, clientes, CRUD admin
│   │   ├── metaApi.js        # envio de mensagens (por tenant)
│   │   ├── sessionService.js # sessões (máquina de estados)
│   │   └── messageHandler.js # orquestração das mensagens
│   ├── flows/
│   │   ├── menu.js           # menu principal
│   │   ├── cotacao.js        # cotações/encomendas
│   │   ├── planos.js         # catálogo e planos
│   │   ├── pagamento.js      # licenças + pagamentos + métodos
│   │   ├── humano.js         # falar com humano
│   │   └── notificacoes.js   # envio automático (utilitário)
│   └── admin/ui.js           # interface do painel
└── sql/
    ├── migrations.sql              # categoria + métodos de pagamento
    ├── migrations_tenants.sql      # tabela tenants + tenant_id
    ├── seed_produtos.sql           # catálogo
    ├── seed_planos.sql             # licenças SaaS
    ├── seed_precos_saas.sql        # preços
    └── seed_bots.sql               # bot + preços
```

---

## 5. O que FALTA fazer

### 5.1 Curto prazo (crítico)
- [ ] **Token permanente da Meta** — o token atual é *temporário* e **expira em
      poucas horas**; quando expirar o bot **para de enviar**. Solução: util. de
      sistema no negócio `890088647173519` com acesso à app `tecno_bot` + WABA
      `1050705194450386`, permissões `whatsapp_business_messaging` +
      `whatsapp_business_management`. Depois actualizar `WHATSAPP_TOKEN` no Vercel.

### 5.2 Pagamentos
- [ ] Integrar gateway **PaySuite / Netshop**: gerar referência de pagamento e
      receber **webhook de confirmação** (hoje em *stub*)
- [ ] Ao confirmar pagamento: `pagamentos.status = confirmado` e
      `licencas.status = ativa` (+ `data_inicio`, `data_expiracao`)

### 5.3 Parte admin (do spec)
- [ ] Confirmação manual de pagamentos (comprovativo) → activar licença
- [ ] Responder a "falar com humano" pelo administrador
- [ ] Criar/editar produtos e planos de forma amigável (por tenant)

### 5.4 Cotações → orçamentos → encomendas
- [ ] Painel/UX para o admin gerar `orcamentos` a partir de `cotacoes`
- [ ] Envio do orçamento ao cliente e resposta "Aceito/Recuso"
- [ ] Geração de `encomendas` a partir de orçamento aceite

### 5.5 Integração com os sistemas SaaS (conectores)
- [ ] Definir como o bot **verifica/activa/renova licenças** dentro de cada
      sistema (Xonguile, Gymar, ...) — requer **API de cada sistema** (ou acesso
      à máquina, ainda pendente)
- [ ] Mapeamento cliente ↔ sistema (`cliente_sistemas` / `referencia_externa`)
- [ ] Camada de "conectores" (um por sistema) com interface única:
      `verificarCliente`, `estadoLicenca`, `renovarLicenca`

### 5.6 Automações
- [ ] **Cron job** diário: licenças a expirar → notificar cliente
- [ ] **Cron job** diário: licenças expiradas → `status = expirada`
- [ ] Notificações ao admin (novo pedido, comprovativo, orçamento aceite)

### 5.7 Onboarding de clientes (SaaS)
- [ ] Fluxo para **criar um bot para um cliente** (novo tenant): ligar o número
      do cliente (Embedded Signup da Meta, ou manual) e configurar catálogo
- [ ] Área no painel admin para gerir tenants

### 5.8 Produção
- [ ] Verificação de negócio já feita no negócio verificado; avaliar exigências
      adicionais da Meta para volume
- [ ] Monitorizar custos (grátis até ~1.000 conversas/mês)

---

## 6. Avisos importantes

- 🔴 **O token actual EXPIROU em 27/09/2026** — o bot não envia. Ver secção 0.
- ⚠️ O **token permanente está bloqueado** pela regra dos 7 dias do Meta.
  O system user `tecnoincubadora-bot` já foi criado; falta só envelhecer.
- ⚠️ **Não** clicar em "migrate / this number is already registered" na Meta.
- ⚠️ O número de teste da Meta **não** serve para produção.
- ⚠️ Segredos só nas variáveis do Vercel; `.env*` está no `.gitignore`.
- ⚠️ O `PENDENTES.md` tem valores de um **projeto antigo** — ignorar.

---

## 7. Como correr / publicar

```bash
# Local (só útil para debug — o WhatsApp nunca chama o localhost)
npm install
npm run dev            # http://localhost:3000  (admin em /admin)

# Vercel (produção) — é aqui que o bot vive
vercel deploy --prod --yes
```

Variáveis necessárias no Vercel: `DATABASE_URL`, `VERIFY_TOKEN`,
`PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `APP_SECRET`, `ADMIN_PASSWORD`.

> `.env.local` só tem `DATABASE_URL` e `ADMIN_PASSWORD`. Para o local enviar
> a sério faltam `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET` e
> `VERIFY_TOKEN` — sem eles o bot local fica em modo MOCK (imprime no terminal).

---

## 8. Resumo executivo

A plataforma está **construída e deployada**: webhook multi-tenant, 5 fluxos de
conversa, catálogo, contratação de licenças, escolha de método de pagamento,
painel admin e páginas legais — sobre uma base de dados povoada
(22 produtos, 38 planos, 4 clientes reais registados hoje).

**Está tudo no ar excepto a voz.** O bot recebe mensagens (prova: clientes e
sessões gravados hoje na BD) mas não responde, porque o `WHATSAPP_TOKEN`
expirou. É um problema de **credencial do Meta**, não de código.

Prioridades: **(a)** repor o token para voltar a responder,
**(b)** token permanente assim que os 7 dias passarem, **(c)** pagamentos
PaySuite/Netshop, **(d)** ligação aos sistemas SaaS, **(e)** automações e
onboarding de clientes.

---

## 9. Token permanente da Meta — como fazer quando os 7 dias passarem

Hoje isto está **bloqueado** pela regra do Meta (ver secção 0). Quando o system
user `tecnoincubadora-bot` completar 7 dias:

1. **Utilizadores de sistema** do negócio `890088647173519` → abrir o utilizador
   `tecnoincubadora-bot` (já existe, não criar outro).
2. **Assign assets** → com **Controlo total**:
   - **Apps** → `tecno_bot`
   - **WhatsApp Accounts** → `1050705194450386`
3. **Generate new token**:
   - App: **`tecno_bot`**
   - **Token expiration: Never** (⚠️ crítico)
   - Permissões: `whatsapp_business_messaging` + `whatsapp_business_management`
4. Actualizar no Vercel e redeployar:
   ```bash
   vercel env rm WHATSAPP_TOKEN production -y
   vercel env add WHATSAPP_TOKEN production   # colar o token permanente
   vercel deploy --prod --yes
   ```
5. **Validar sempre** antes de achar que ficou bom:
   ```
   GET /admin/api/meta-status   (com login de admin)
   ```
  tem de devolver `ok: true`. É mais fiável que mandar mensagem e esperar.

---

## 10. Alterações feitas a 27/09/2026 (diagnóstico)

| Ficheiro | Alteração | Porquê |
|---|---|---|
| `src/config/env.js` | passou a carregar `.env.local` e `.env` | `dotenv/config` só lia `.env`; o ficheiro existente é `.env.local` → local arrancava sem BD e sem password |
| `src/services/metaApi.js` | erro `190` da Meta passa a mensagem explícita `TOKEN DA META EXPIRADO/INVÁLIDO` | o erro raw não dizia o que era |
| `src/routes/webhook.js` | log avisa que a mensagem foi recebida mas não houve resposta | a falha de envio desaparecia em silêncio |
| `src/routes/admin.js` | novos `GET /admin/api/meta-status` e `POST /admin/api/meta-test-send` (protegidos por password) | permitir validar o canal sem expor segredos |
| `sql/migrations_tenants.sql` | corrigidos `phone_number_id` e `waba_id` | semeava `1342368558963042` / `1013279915105305`, que não existem |

> Nenhum destes endpoints expõe segredos. Podem ser removidos se não forem
> pretendidos.

