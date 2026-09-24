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

O bot já está hospedado no Vercel:

**URL público:** `https://whatsappbot-gold.vercel.app`
**Webhook:** `https://whatsappbot-gold.vercel.app/webhook`

### Variáveis já configuradas no Vercel

| Variável | Valor atual |
|---|---|
| `VERIFY_TOKEN` | `IuAZjHEDzxNsL7GckVgq9aJK` |
| `WHATSAPP_TOKEN` | **placeholder `Secret`** (trocar quando tiveres a chave real) |
| `PHONE_NUMBER_ID` | **placeholder `none`** (trocar quando tiveres o ID real) |

### Como alterar variáveis e refazer o deploy

Quando tiveres as credenciais da Meta:

```bash
vercel env add WHATSAPP_TOKEN production   # cola o token real
vercel env add PHONE_NUMBER_ID production  # cola o ID real
vercel deploy --prod --yes                 # refaz o deploy
```

> ⚠️ Enquanto `WHATSAPP_TOKEN` for `Secret`, o webhook **recusa** mensagens sem assinatura válida
> (resposta 401). Por isso, ao configurar a Meta, usa logo os valores reais.

### Estrutura usada para o Vercel

- `server.js` é a entrada única (app Express) — o Vercel deteta o preset Express
- Não é preciso `api/` nem `vercel.json`

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
| Erro `Meta API 401` | Token expirado (token temporário dura 24h) | Gera um novo na Meta, ou usa um Permanent Token |
| Tabela `clientes` não existe | `sql/init.sql` não foi corrido no Neon | Corre o script no SQL Editor |

---

## 🧭 Próximos passos sugeridos

1. Gerar **Permanent Token** no Meta Business Manager (evita expirar de 24 em 24h)
2. Submeter a app para **verificação de negócio** da Meta (necessário em produção)
3. Ligar `notificacoes.js` aos eventos de pagamento da vossa API
4. Conectar a vossa **API central TECNOINCUBADORA** via `dbService.js`