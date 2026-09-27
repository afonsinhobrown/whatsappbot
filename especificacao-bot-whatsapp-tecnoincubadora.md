# Especificação Funcional — Bot WhatsApp TECNOINCUBADORA

## 1. Objectivo

Bot de WhatsApp que atende clientes e potenciais clientes da TECNOINCUBADORA, permitindo:
- Pedir cotações de produtos/serviços
- Pagar licenças de SaaS e bots
- Comprar plugins
- Encomendar sistemas/serviços por desenvolver (com orçamento à medida)

Base de dados: PostgreSQL (Neon), já criada com as tabelas `clientes`, `produtos`, `planos`, `licencas`, `cotacoes`, `orcamentos`, `encomendas`, `pagamentos`, `bot_sessoes`.

## 2. Stack recomendada

- **WhatsApp API:** WhatsApp Business Cloud API (Meta) ou Baileys (não-oficial, mais barato mas instável)
- **Backend:** Node.js (Express/Fastify)
- **BD:** PostgreSQL (Neon) via `pg` ou Prisma/Drizzle
- **Gestão de estado da conversa:** tabela `bot_sessoes` (campo `contexto` JSONB)
- **Pagamentos:** M-Pesa API / e-Mola API (Mozambique) + confirmação manual/admin como fallback

## 3. Fluxo principal do bot

### 3.1 Primeira mensagem / boas-vindas
- Se número não existe em `clientes` → cria registo
- Menu principal (botões ou lista numerada):
  1. Pedir cotação
  2. Ver planos/preços (SaaS, bots, plugins)
  3. Pagar licença existente
  4. Encomendar sistema/serviço novo
  5. Falar com humano

### 3.2 Pedir cotação
- Bot pergunta: tipo de pedido (produto existente / sistema custom / serviço)
- Recolhe descrição em texto livre
- Grava em `cotacoes` (status `aberta`)
- Notifica admin (Afonso) via WhatsApp/email/Telegram
- Responde ao cliente: "Cotação recebida, vais receber orçamento em X dias"

### 3.3 Ver planos/preços
- Lista produtos activos (`produtos.ativo = true`)
- Para cada produto escolhido, mostra planos (`planos`) com preço e periodicidade
- Cliente escolhe plano → gera `licencas` (status `pendente`) → avança para pagamento

### 3.4 Pagar licença existente
- Bot pede: número de licença ou identifica automaticamente pelas licenças do cliente
- Mostra valor em dívida
- Cliente escolhe método (M-Pesa / e-Mola / transferência)
- Se API automática: gera pedido de pagamento, aguarda webhook, confirma automaticamente
- Se manual: pede print/comprovativo (imagem), grava `comprovativo_url`, status `pendente`, admin confirma manualmente
- Ao confirmar: actualiza `pagamentos.status = confirmado`, activa/renova `licencas` (`status = ativa`, actualiza `data_expiracao`)

### 3.5 Encomendar sistema/serviço novo
- Recolhe descrição do que precisa + orçamento disponível (opcional)
- Grava em `cotacoes` (`tipo_pedido = sistema_custom`)
- Fluxo segue para orçamento manual do admin → `orcamentos` → aprovação do cliente → `encomendas`

### 3.6 Aprovação de orçamento
- Bot envia ao cliente o orçamento gerado (valor, prazo, condições de pagamento)
- Cliente responde "Aceito" ou "Recuso"
- Se aceite: cria `encomendas` (status `em_desenvolvimento`), pede sinal/adiantamento conforme `condicoes_pagamento`
- Se recusa: `orcamentos.status = rejeitado`

### 3.7 Falar com humano
- Marca sessão como `estado_atual = aguardando_humano`
- Notifica Afonso directamente
- Bot pausa respostas automáticas até admin retomar (ou timeout de X horas)

## 4. Gestão de estado (bot_sessoes)

Cada cliente tem uma sessão activa com `estado_atual` (máquina de estados) e `contexto` (JSONB) guardando dados temporários do fluxo em curso (ex: produto escolhido, valor calculado, etapa do formulário).

Estados sugeridos:
`inicio`, `escolhendo_produto`, `escolhendo_plano`, `aguardando_pagamento`, `aguardando_comprovativo`, `preenchendo_cotacao`, `aguardando_aprovacao_orcamento`, `aguardando_humano`

## 5. Notificações para o admin (Afonso)

Eventos que devem gerar notificação imediata:
- Nova cotação recebida
- Novo comprovativo de pagamento enviado (para confirmação manual)
- Cliente pediu para falar com humano
- Orçamento aceite pelo cliente
- Licença prestes a expirar (aviso automático X dias antes, também ao próprio cliente)

## 6. Automatizações necessárias

- **Cron job diário:** verificar `licencas` com `data_expiracao` próxima → notificar cliente via WhatsApp para renovar
- **Cron job diário:** marcar `licencas` expiradas (`data_expiracao < now()`) → `status = expirada`
- **Webhook de pagamento:** se usar API M-Pesa/e-Mola, endpoint que recebe confirmação e actualiza `pagamentos` + `licencas`/`encomendas` automaticamente

## 7. Regras de negócio importantes

- Um pagamento (`pagamentos`) refere-se sempre a **um** de: licença, orçamento ou encomenda (`referencia_tipo` + `referencia_id`)
- Licença só fica `ativa` depois de pagamento `confirmado`
- Cotação só avança para orçamento depois de análise do admin (não é automático)
- Trabalho STAE **nunca** deve aparecer em interacções deste bot (produto/serviço separado, fora deste catálogo)

## 8. Fora de âmbito (v1)

- Emissão de factura fiscal automática
- Suporte multi-idioma (apenas português)
- Pagamento por cartão internacional

## 9. Entregáveis esperados do agente

- Bot funcional ligado à API do WhatsApp escolhida
- Integração completa com a BD Postgres (Neon) já criada
- Painel simples (ou comandos admin) para: confirmar pagamentos manuais, responder a "falar com humano", criar/editar produtos e planos
- Documentação de setup (variáveis de ambiente, deploy)
