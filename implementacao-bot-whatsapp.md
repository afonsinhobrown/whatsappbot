# DOCUMENTO DE IMPLEMENTAÇÃO — BOT DE AUTOMAÇÃO WHATSAPP
## TECNOINCUBADORA

---

## 1. OBJETIVO

Bot de automação WhatsApp integrado com a API central TECNOINCUBADORA, para atendimento, notificações e consulta/registo de dados dos produtos SaaS (CredHubMZ, Xonguile, Gymar, etc.).

---

## 2. STACK TÉCNICA

- **Canal:** WhatsApp Business Platform — Meta Cloud API (rota oficial, obrigatória para clientes pagantes)
- **Backend:** Node.js + Express
- **Base de dados:** Neon/Postgres (já usado nos outros produtos)
- **Hospedagem webhook:** Render/Vercel (conforme setup atual)

**Nota:** rota não-oficial (Baileys/whatsapp-web.js) descartada para produção — risco de ban do número.

---

## 3. ESTRUTURA DE FICHEIROS

```
whatsapp-bot/
  src/
    routes/
      webhook.js          (recebe mensagens da Meta)
    services/
      metaApi.js           (envio de mensagens)
      messageHandler.js    (lógica de resposta/fluxo)
      dbService.js          (consultas à base de dados)
    flows/
      atendimento.js
      notificacoes.js
      consultaDados.js
    config/
      env.js
  server.js
```

---

## 4. SETUP INICIAL (META)

1. Criar app no Meta for Developers
2. Ativar produto "WhatsApp" na app
3. Configurar número de telefone (teste grátis ou número verificado do negócio)
4. Obter: `PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `VERIFY_TOKEN`
5. Configurar Webhook URL apontando para o endpoint do backend
6. Submeter para verificação de negócio (Meta Business Manager) — necessário para produção/volume

---

## 5. ARQUITETURA DE INTEGRAÇÃO

```
Utilizador (WhatsApp) → Meta Cloud API → Webhook (Node.js) 
→ messageHandler → dbService → Base de dados (Neon)
→ resposta via metaApi.js → Meta Cloud API → Utilizador
```

**Regras obrigatórias:**
- Webhook valida `VERIFY_TOKEN` na configuração inicial (handshake com Meta)
- Toda mensagem recebida é validada (assinatura/origem) antes de processar
- Backend nunca expõe token da Meta API no lado do cliente (não aplicável aqui, mas manter boas práticas)
- Rate limiting no webhook para evitar abuso

---

## 6. FLUXO DE MENSAGEM (exemplo: consulta de dados)

1. Cliente envia mensagem ("qual o meu saldo")
2. Meta envia POST para `webhook.js`
3. `messageHandler.js` identifica intenção (regras simples ou parsing de texto)
4. `dbService.js` consulta a base de dados (ex: saldo do cliente no CredHubMZ)
5. `metaApi.js` envia resposta formatada de volta ao número do cliente

---

## 7. TIPOS DE FLUXO A IMPLEMENTAR

- **Atendimento/FAQ:** respostas pré-definidas a perguntas frequentes
- **Notificação transacional:** disparo automático (confirmação de pagamento, lembrete)
- **Consulta de dados:** cliente pergunta, bot consulta BD e responde
- **Fluxo conversacional (menu):** opções numeradas para navegação sem digitação livre

---

## 8. ORDEM DE DESENVOLVIMENTO

1. Setup da app Meta + configuração de webhook (handshake de verificação)
2. Endpoint básico que recebe e loga mensagens (confirmar recebimento funciona)
3. `metaApi.js` — envio de mensagem de resposta simples ("olá, recebido")
4. `messageHandler.js` — lógica de identificação de intenção
5. `dbService.js` — integração com base de dados existente
6. Implementar 1 fluxo completo (ex: consulta de saldo) ponta a ponta
7. Expandir para os outros fluxos (notificações, FAQ, menu)
8. Testes com número real, ajustar limites e tratamento de erro

---

## 9. CUSTOS A MONITORIZAR

- Grátis até 1.000 conversas/mês
- Acima disso: cobrança por conversa (varia por país/categoria de mensagem)
- Verificação de negócio: grátis, mas processo pode levar dias/semanas

---

## 10. ENTREGÁVEL ESPERADO DO AGENTE

- Webhook funcional, validado pela Meta
- Envio e receção de mensagens operacional
- Pelo menos 1 fluxo completo integrado com a base de dados
- Estrutura pronta para expansão (novos fluxos por produto SaaS)
