# 📋 PENDENTES — WhatsAppBot TECNOINCUBADORA

> ⚠️ **FICHEIRO OBSOLETO — NÃO USAR COMO REFERÊNCIA.**
>
> Este ficheiro refere um **projeto antigo** (`whatsappbot-gold`, app `wassppbot`).
> Todos os identificadores aqui estão **errados** para a configuração actual.
>
> A app real é a `tecno_bot` (`1089227356929033`), o número é `+258 86 139 0985`
> (`phone_number_id` `1349279428267688`) e a app está em
> `https://tecnoincubadora-admin-bots.vercel.app`.
>
> **O estado actual e o que falta está em [`RELATORIO.md`](RELATORIO.md), secção 0.**

---

<details>
<summary>Conteúdo antigo (arquivado)</summary>

> Última atualização: 24/09/2026
> Legenda: `[ ]` por fazer · `[x]` feito

---

## ✅ Já está feito

- [x] Código completo (webhook, envio, fluxos FAQ/saldo/notificações)
- [x] Deploy no Vercel → `https://whatsappbot-gold.vercel.app`
- [x] Webhook validado pela Meta (`GET /webhook` responde ao handshake)
- [x] `VERIFY_TOKEN` configurado
- [x] `PHONE_NUMBER_ID` e `WHATSAPP_TOKEN` reais configurados no Vercel
- [x] Teste de receção de mensagem com assinatura Meta válida → `EVENT_RECEIVED`
- [x] Repositório GitHub atualizado: `https://github.com/afonsinhobrown/whatsappbot`

---

## ⏳ PENDENTES

### 1. Criar token PERMANENTE da Meta (uma única vez)

O token atual (temporário) dura **24 horas**. Para não repetir todos os dias:

- [ ] Abrir `https://business.facebook.com/settings/system-users`
- [ ] **Add** → nome `whatsappbot-bot` → função **Admin** → **Add user**
- [ ] **Assign assets** → **Apps** → ligar a app `wassppbot`
- [ ] **Generate new token** com permissões:
  - [ ] `whatsapp_business_messaging`
  - [ ] `whatsapp_business_management`
- [ ] Copiar o token
- [ ] Atualizar no Vercel e refazer deploy:
  ```bash
  vercel env add WHATSAPP_TOKEN production
  vercel deploy --prod --yes
  ```

### 2. Receber mensagens no teu WhatsApp (teste ponta a ponta)

- [ ] Meta → **WhatsApp → API Setup** → campo **"To"** → adicionar **o teu número**
- [ ] Confirmar o código que chega por WhatsApp
- [ ] Meta → **WhatsApp → Configuration → Webhook fields** → subscrever **messages**
- [ ] Confirmar que a Callback URL é `https://whatsappbot-gold.vercel.app/webhook`
- [ ] Confirmar que o Verify token é `IuAZjHEDzxNsL7GckVgq9aJK`
- [ ] Enviar `menu` para o número e ver se o bot responde

### 3. Base de dados real (Neon) — opcional

Sem isto, o bot usa dados **DEMO** em memória.

- [ ] Criar conta em `https://neon.tech`
- [ ] Copiar a connection string (`postgresql://...`)
- [ ] Correr `sql/init.sql` no SQL Editor do Neon
- [ ] Adicionar `DATABASE_URL` no Vercel:
  ```bash
  vercel env add DATABASE_URL production
  vercel deploy --prod --yes
  ```

### 4. Adicionar clientes reais

- [ ] Inserir os clientes na tabela `clientes` (Neon) ou editar a lista demo em `src/services/dbService.js`
- [ ] Confirmar que o número fica no formato `258XXXXXXXXX` (só dígitos, com código do país)

### 5. Produção / verificação (mais tarde)

- [ ] Submeter a app à **verificação de negócio** da Meta (Business Manager)
- [ ] Ligar `src/flows/notificacoes.js` aos eventos de pagamento da API central
- [ ] Ligar o `dbService.js` à API central TECNOINCUBADORA
- [ ] Monitorizar os custos (grátis até 1.000 conversas/mês)

---

## 🔑 Dados de referência

| Item | Valor |
|---|---|
| URL do bot | `https://whatsappbot-gold.vercel.app` |
| URL do webhook | `https://whatsappbot-gold.vercel.app/webhook` |
| VERIFY_TOKEN | `IuAZjHEDzxNsL7GckVgq9aJK` |
| PHONE_NUMBER_ID | `1336702446191164` |
| App ID Meta | `1398494705189622` |
| Repositório | `https://github.com/afonsinhobrown/whatsappbot` |

---

## ⚠️ Avisos

- **NÃO** clicar em "migrate/this phone number is already registered" na Meta — isso mexe no teu número pessoal.
- O token **temporário** expira em 24h → criar o **permanente** (tarefa 1).
- O ficheiro `.env` é local e **não** vai para o GitHub (já está no `.gitignore`).
- As credenciais no Vercel estão guardadas como *Secret* (não se leem de volta).

</details>
