# 🤖 WhatsAppBot — TECNOINCUBADORA

Bot de automação WhatsApp integrado com a **Meta Cloud API** (rota oficial) para
atendimento, consulta de dados e notificações dos produtos SaaS (CredHubMZ, Xonguile, Gymar...).

---

## ⚙️ O que precisas de ter instalado

| Ferramenta | Onde baixar | Para quê |
|---|---|---|
| **Node.js 18+** | https://nodejs.org | Para correr o bot |
| **Git** | https://git-scm.com | Já tens (usámos para o repositório) |
| **Conta Meta for Developers** | https://developers.facebook.com | Chaves da API do WhatsApp |
| **(Opcional) Conta Neon** | https://neon.tech | Base de dados Postgres |

> Podes testar o bot **sem base de dados** (modo DEMO) e **sem conta Meta** (modo MOCK).
> A ordem recomendada para principiantes está no guia abaixo.

---

## 🚀 Como correr o bot (passo a passo)

### 1. Instalar as dependências

```bash
npm install
```

### 2. Criar o ficheiro de configuração

```bash
# No Windows PowerShell:
Copy-Item .env.example .env
```

Abre o `.env` num editor de texto (Bloco de Notas serve).
Primeiro, deixa as variáveis todas **vazias** exceto `VERIFY_TOKEN`, onde escreves
qualquer texto, por exemplo:

```env
VERIFY_TOKEN=tecno2024
```

### 3. Correr em modo DEMO + MOCK (teste sem Meta)

```bash
npm run dev
```

Vais ver mensagens assim no terminal:

```
[D B] DATABASE_URL não definido — a usar base de dados DEMO em memória
[MOCK] Para 258840000001: Olá Ana! ...
```

Abre o browser em `http://localhost:3000/` e deve aparecer:

```json
{ "service": "whatsappbot", "status": "ok" }
```

Isso confirma que instalaste tudo corretamente. ✅

---

## 🔌 Ligar o WhatsApp real (Meta Cloud API)

> Só funciona a partir do **número de telemóvel associado ao WhatsApp Business**.
> Os teus clientes falarão sempre com esse número.

### Passo A — Criar a app na Meta

1. Entra em https://developers.facebook.com/apps
2. **Create App** → escolhe **Other** → **Business** como tipo → dá um nome (ex: `whatsappbot`)
3. No painel da app, procura o produto **WhatsApp** → **Set up**
4. Em **API Setup**, vais ver o `Phone number ID` e um `Temporary access token`

### Passo B — Preencher o `.env`

Pega nos valores do painel e junta ao teu `.env`:

```env
PHONE_NUMBER_ID=1234567890
WHATSAPP_TOKEN=EAAG4pandoraboxlongotokenqualquer
```

### Passo C — Testar com o "Send and receive messages" da Meta

Dentro do mesmo painel da Meta há um botão **Send and receive messages**.
Escolhe o teu número, escreve `menu` e envia para o teu número do WhatsApp.
Isto usa o endpoint diretamente — se responder, a tua `metaApi.js` também vai funcionar.

### Passo D — Configurar o Webhook (para o bot RECEBER mensagens)

O bot precisa de um **endereço público na internet** para a Meta enviar mensagens.
Para isso:

1. Ou fazes **deploy** (ver secção abaixo) e usas o URL do Render,
2. Ou, para testes locais, instala o túnel **ngrok**: https://ngrok.com
   ```bash
   ngrok http 3000
   ```
   Ele dá-te um URL tipo `https://abc123.ngrok-free.app`.

Quando tiveres o URL público, na Meta:

1. Em **WhatsApp → Configuration → Webhook**, clica **Edit**
2. **Callback URL:** `https://TEU_URL/webhook`
3. **Verify token:** escreve exatamente o valor que puseste em `VERIFY_TOKEN` no `.env`
4. Clica **Verify and save** — o bot responde ao handshake automaticamente ✅
5. De seguida, em **Webhook fields**, subscreve o campo **messages**
6. **Test**: envia `menu` para o teu número e vê a resposta no WhatsApp

> ⚠️ O bot tem de estar a correr no momento do teste (na mesma máquina, via `npm run dev`).

---

## 🗄️ Base de dados real (Neon / Postgres)

1. Cria uma conta em https://neon.tech e um projecto (região à escolha)
2. Copia a *connection string* (algo como `postgresql://user:pass@ep-xxx.aws.neon.tech/db?sslmode=require`)
3. No painel do Neon abre o **SQL Editor**, cola o conteúdo de `sql/init.sql` e executa
4. Cola a connection string no `.env`:

   ```env
   DATABASE_URL=postgresql://user:pass@...neon.tech/db?sslmode=require
   ```

5. Reinicia o bot (`Ctrl+C` e `npm run dev`). Agora o fluxo de saldo consulta o Postgres.

---

## ☁️ Deploy (Vercel) — JÁ ESTÁ NO AR!

**Projeto:** `afonsos-projects-e7645dac/tecnoincubadora-admin-bots`
**URL público:** `https://tecnoincubadora-admin-bots.vercel.app`
**Webhook:** `https://tecnoincubadora-admin-bots.vercel.app/webhook`

### 🔑 Relatório: token permanente do WhatsApp (CONCLUÍDO em 2026-10-03)

O bot já **não depende mais de token temporário**. Este é o registo do que foi feito.

#### Antes vs. agora

| | Antes | Agora |
|---|---|---|
| Tipo de token | Temporário (24 h) | **System User (permanente)** |
| Origem | App Dashboard → API Setup | Business Settings → System Users |
| Falhava com | `OAuthException 190` a cada 24 h | Não expira |

#### Como foi gerado

1. `https://business.facebook.com/settings/system-users`
2. **+ Add** → nome `whatsappbot-bot` → papel **Admin** → **Create System User**
3. **Assign Assets** → app com **Manage app** (Full control) + conta WhatsApp com
   **Manage WhatsApp Business accounts** (Full control)
4. **Generate token** com as permissões:
   - `business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

#### Onde o token foi instalado (3 camadas)

| # | Destino | Detalhe |
|---|---|---|
| 1 | **`tenants.token`** (Postgres) | `tenants.id = 1` / `TECNOINCUBADORA` — **é esta camada que envia** |
| 2 | `.env.local` | ficheiro local, coberto pelo `.gitignore` |
| 3 | Vercel `WHATSAPP_TOKEN` | Secret, ambiente Production |

> O valor do token **nunca** deve ser escrito neste ficheiro, commitado ou colado em
> issue/chat. Está guardado apenas nos 3 destinos acima.

#### Ordem de resolução (o que o código faz)

`src/services/metaApi.js:12`

```js
const token = (tenant && tenant.token) || env.whatsappToken;
```

O token do **tenant na base de dados ganha**; `WHATSAPP_TOKEN` é apenas *fallback*.
O tenant é resolvido a partir do `phone_number_id` que vem no webhook
(`src/routes/webhook.js:66` → `src/services/dbService.js:79`
`getTenantByPhoneNumberId`).

Se a tabela `tenants.token` estiver vazia, o bot degrada para MOCK
(`src/services/metaApi.js:15`) e os envios são apenas simulados.

#### Identificadores da conta WhatsApp

| Campo | Valor |
|---|---|
| `phone_number_id` | `1349279428267688` |
| `waba_id` | `1050705194450386` |
| Número | `+258 86 139 0985` |
| Nome verificado | `TECNO_BOT` |
| Base de dados | Neon `ep-old-mountain-b5yvr8av` (us-east-2), db `bots` |

#### Validação feita

```bash
curl -s "https://graph.facebook.com/v23.0/1349279428267688?fields=display_phone_number,verified_name" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN"
# -> {"display_phone_number":"+258 86 139 0985","verified_name":"TECNO_BOT",...}
```

Redeploy: `vercel redeploy <url-do-deploy-anterior> --target=production`
→ `vepusyhwt`, Ready em 14 s, com alias em `tecnoincubadora-admin-bots.vercel.app`.

> ⚠️ Erro cometido durante a configuração, para não se repetir: o token foi
> transcrito de mão com um caractere trocado (`U` por `Y` em `...VsuUYmY5ug6...`).
> O Symptoms foi `OAuthException 190 — "The access token could not be decrypted"`.
> Se aparecer esse erro, **não é o token da Meta**: é transcrição. Copia/cola sempre.

### Como alterar variáveis e refazer o deploy

```bash
# Mudar um valor já existente (o `vercel env add` duplica, tem de remover antes)
vercel env rm WHATSAPP_TOKEN production --yes
vercel env add WHATSAPP_TOKEN production --sensitive   # cola o valor
vercel redeploy <url-do-deploy-anterior> --target=production
```

Variáveis já configuradas no Vercel: `VERIFY_TOKEN`, `WHATSAPP_TOKEN`,
`PHONE_NUMBER_ID`, `APP_SECRET`, `ADMIN_PASSWORD`, `ADMIN_NUMBERS`,
`ADMIN_WATSAPP_NUMBER`, `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_URL`,
`PAYSUITE_API_TOKEN`, `PAYSUITE_WEBHOOK_SECRET` e as 8 `*_NEON_URL` / `*_SUPABASE_URL`
por tenant.

### Estrutura usada para o Vercel

- `server.js` é a entrada única (app Express) — o Vercel deteta o preset Express
- Não é preciso `api/` nem `vercel.json`

### ⚠️ Risco de segurança em aberto (não corrigido)

`tenants.token` é guardado em **texto puro** e **não é mascarado** em nenhuma saída:

- `sql/migrations_tenants.sql:10` — `token TEXT` (sem `pgcrypto`, sem cifra)
- `src/services/dbService.js:197` — `listRows` faz `SELECT *`, logo devolve a coluna
- `src/routes/admin.js:100` — `GET /rows` expõe a linha ao browser
- `src/admin/ui.js:139,164` — a grelha e o modal de edição renderizam o token
- `src/routes/admin.js:144` — `/meta-status` diagnostica só a variável de ambiente,
  ignorando o token do tenant que é realmente usado nos envios

Não existe helper de criptografia no projecto (sem `ENCRYPTION_KEY`, sem `crypto.js`).
O único uso de `crypto` é a validação de assinatura HMAC dos webhooks
(`src/routes/webhook.js:98`).

Impacto: qualquer pessoa com sessão de admin válida lê o token da Meta em texto
claro. Correção sugerida: cifra com `pgcrypto` ou com um helper AES simétrico
chaveado por `ENCRYPTION_KEY`, e mascarar a coluna nas respostas da API.

---

## 📁 Estrutura do projecto

```
whatsappbot/
├── server.js                    # Servidor Express (ponto de entrada)
├── sql/init.sql                 # Cria a tabela clientes no Neon
├── src/
│   ├── config/env.js            # Lê variáveis de ambiente
│   ├── routes/webhook.js        # Handshake + receção de mensagens (Meta)
│   ├── services/
│   │   ├── metaApi.js           # Envio de mensagens (Call Graph API)
│   │   ├── messageHandler.js    # Decide qual fluxo responder
│   │   └── dbService.js         # Consultas (Neon/Postgres ou DEMO)
│   └── flows/
│       ├── atendimento.js       # FAQ + falar com atendente
│       ├── consultaDados.js     # Consulta de saldo
│       └── notificacoes.js      # Envio automático (pagamentos, lembretes)
```

---

## 💬 O que o bot já sabe responder

| Mensagem do cliente | Comportamento |
|---|---|
| `menu`, `ola`, `iniciar` | Mostra as opções |
| `1` ou `qual é o meu saldo` | Consulta e devolve o saldo do cliente |
| `2`, `atendente`, `humano` | Regista pedido de atendimento humano |
| `3`, `faq`, `ajuda` | Lista de perguntas frequentes |
| `esqueci a senha` / `como pagar` / `horário` | Resposta automática (FAQ) |
| qualquer outra coisa | Responde com o menu |

---

## 🐛 Resolução de problemas

| Problema | Causa provável | Solução |
|---|---|---|
| `http://localhost:3000` não abre | O bot não está a correr | `npm run dev` |
| Meta diz "verification failed" | `VERIFY_TOKEN` difere entre `.env` e Meta | Vê o Passo D |
| Não recebe mensagens do WhatsApp | Webhook não subscrito ou bot/ngrok parado | Abre o terminal e reinicia o ngrok + `npm run dev` |
| Erro `Meta API 401` | Token expirado (token temporário dura 24h) | Já resolvido: há token permanente. Vê o relatório acima. Se der `190 could not be decrypted`, é transcrição errada do token |
| Erro `Meta API 190 — could not be decrypted` | Token copiado com caractere trocado | Copia/cola de novo; validar com o `curl` da secção do relatório |
| Tabela `clientes` não existe | `sql/init.sql` não foi corrido no Neon | Corre o script no SQL Editor |

---

## 🧭 Próximos passos sugeridos

1. ✅ **Permanent Token** no Meta Business Manager — feito em 2026-10-03 (ver relatório)
2. Cifrar `tenants.token` e mascará-lo nas respostas da API de admin
3. Remover as chamadas sem `tenant` que caem no token de ambiente:
   `src/routes/admin.js:199,263,293` e `src/flows/notificacoes.js:13`
   (`sendNotification` nem aceita `tenant`)
4. Apanhar o `waba_id`, que é escrito na BD mas nunca lido pelo código
5. Submeter a app para **verificação de negócio** da Meta (necessário em produção)
6. Ligar `notificacoes.js` aos eventos de pagamento da vossa API