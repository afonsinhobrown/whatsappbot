# RELATÓRIO DE ESTADO — BUÉ DE MESTRES
**Data:** 30 Set 2026 · **Sessão encerrada às:** 15:03

---

## ✅ CONCLUÍDO HOJE

### Infra-estrutura (Monorepo)
- Migração para **Turborepo** (pnpm workspaces)
- `apps/web/` — todo o Next.js anterior preservado
- `apps/cliente/` — Expo inicializado
- `apps/pro/` — Expo inicializado
- `packages/domain/` — regras partilhadas (estados do job, comissões, formatação MT, raios de despacho)
- `packages/providers/` — interfaces `PaymentProvider`, `KycProvider`, `MapProvider` + stubs de dev

### Base de Dados (Neon, já aplicado)
- `0199_enums.sql` — novos valores de enum (on_demand, escrow, kyc stages…)
- `0200_on_demand.sql` — PostGIS + `provider_presence`, `request_offers`, `job_payments`, `payouts`, `platform_revenue`, KYC rígido, funções `nearby_providers`, `accept_offer`, `agree_price`, `hold_job_payment`, `release_job_payment`

### App Cliente (Expo)
| Ecrã | Ficheiro | Estado |
|---|---|---|
| Início | `app/index.tsx` | ✅ |
| Novo pedido on-demand (3 passos) | `app/pedido/novo.tsx` | ✅ |
| Radar de despacho (rondas) | `app/pedido/a-procurar.tsx` | ✅ |
| Mestre a caminho + ETA | `app/pedido/mestre-a-caminho.tsx` | ✅ |
| Proposta de preço + escrow | `app/pedido/proposta-preco.tsx` | ✅ |
| Confirmar serviço / Disputa | `app/pedido/confirmar.tsx` | ✅ |

### App Pro / Mestre (Expo)
| Ecrã | Ficheiro | Estado |
|---|---|---|
| Início + toggle Online/Offline | `app/index.tsx` | ✅ |
| Oferta com contagem de 60 s | `app/oferta/[offerId].tsx` | ✅ |
| A caminho → Chegada → Em serviço | `app/trabalho/a-caminho.tsx` | ✅ |

---

## ⏳ O QUE FALTA (por prioridade)

### 🔴 CRÍTICO — App Pro (próxima sessão)

| # | Ecrã | Ficheiro a criar | Descrição |
|---|---|---|---|
| 1 | **Propor preço** | `apps/pro/app/trabalho/propor-preco.tsx` | Mestre cria linhas de serviço + total. Chama `agree_price()`. Aguarda pagamento do cliente |
| 2 | **Aguardar pagamento** | `apps/pro/app/trabalho/aguardar-pagamento.tsx` | Ecrã com spinner e estado "Retido" quando webhook confirmar |
| 3 | **Serviço em curso** | `apps/pro/app/trabalho/em-curso.tsx` | Estado final antes de "Concluído". Botão para encerrar |
| 4 | **Notificações Push** | `apps/pro/app/notificacoes.ts` | Registar token FCM no Supabase; ouvir novas ofertas em background (high-priority) |
| 5 | **Localização em background** | `apps/pro/lib/location-task.ts` | `expo-task-manager` + `expo-location` (foreground service Android) a enviar posição para `provider_presence` de 30 em 30 s quando Online |

### 🟠 IMPORTANTE — KYC (verificação de identidade)

| # | Ecrã | Ficheiro a criar | Descrição |
|---|---|---|---|
| 6 | **Início da verificação** | `apps/pro/app/verificacao/index.tsx` | Linha do tempo com 9 etapas; estado actual em destaque |
| 7 | **Captura de documento** | `apps/pro/app/verificacao/documento.tsx` | Câmara com moldura, detecção de nitidez, frente + verso |
| 8 | **Selfie + prova de vida** | `apps/pro/app/verificacao/selfie.tsx` | Moldura oval, desafio (piscar/sorrir), múltiplos frames |
| 9 | **Confirmar dados OCR** | `apps/pro/app/verificacao/confirmar-dados.tsx` | Campos pré-preenchidos pelo OCR, mestre confirma/corrige |
| 10 | **Aguardar revisão** | `apps/pro/app/verificacao/aguardar.tsx` | Linha do tempo animada; notificação quando aprovado |

### 🟡 IMPORTANTE — App Web (Next.js) ainda em falta

| # | Página | Caminho | Descrição |
|---|---|---|---|
| 11 | **Painel do mestre — Editar perfil** | `apps/web/src/app/(provider)/pro/perfil/page.tsx` | Bio, nome, distrito, WhatsApp, categorias |
| 12 | **Gerir serviços e preços** | `apps/web/src/app/(provider)/pro/servicos/page.tsx` | Tabela CRUD de `provider_services` |
| 13 | **Afiliados** | `apps/web/src/app/(provider)/pro/afiliados/page.tsx` | Código/link, comissões pendentes/pagas |
| 14 | **Admin — Fila de verificações** | `apps/web/src/app/(admin)/verificacoes/page.tsx` | Aprovar/rejeitar KYC com SLA |
| 15 | **Admin — Pagamentos pendentes** | `apps/web/src/app/(admin)/pagamentos/page.tsx` | Confirmar comprovativo manual; chamar `complete_payment()` |
| 16 | **Admin — Relatórios** | `apps/web/src/app/(admin)/relatorios/page.tsx` | Receita por tipo, conversão, mestres activos |

### 🔵 SUPERADMIN (Fases 10–14, doc TICKETS_SUPERADMIN)

| # | Módulo | Descrição resumida |
|---|---|---|
| 17 | **Middleware `/staff`** | MFA obrigatório, sessão isolada, banner laranja de aviso |
| 18 | **Tickets e SLAs** | Helpdesk interno, fila por prioridade, contadores de tempo |
| 19 | **Auditoria e "Ver Como"** | Impersonation auditado, `audit_logs` em cada acção |
| 20 | **Dupla aprovação** | Levantamentos e comissões acima de limite exigem 2 admins |
| 21 | **Relatórios financeiros** | Reconciliação diária operador vs DB, exportação contabilística |

### ⚪ INFRAESTRUTURA — antes do lançamento

| # | Tarefa | Nota |
|---|---|---|
| 22 | **Worker de despacho** | Edge Function ou servidor Node que corre `nearby_providers` por ronda e cria `request_offers` |
| 23 | **Cron jobs activos** | `pg_cron`: auto-release 24h, expirar ofertas, presença stale, limpeza trilhos |
| 24 | **RLS completo** | Activar e testar políticas em `provider_presence`, `job_payments`, `payouts`, `verification_*` |
| 25 | **Páginas legais** | Termos, Privacidade, Política de reembolsos (em Português MZ) |
| 26 | **PWA (web)** | Manifest + Service Worker na app Next.js |

---

## DECISÕES PENDENTES (com a RFL — fora do código)

1. Fornecedor KYC (API comercial vs stack própria) — testar documentos reais antes de decidir
2. Provedor de mapas — OSM no arranque; definir orçamento antes de activar Google/Mapbox
3. Comissões finais por plano (actualmente: Grátis 12%, Pro 8%, Premium 5%)
4. Pagamento em dinheiro: sim/não no piloto
5. Constituição da entidade + contas comerciais M-Pesa/e-Mola (caminho crítico)
6. Contas Google Play e Apple Developer

---

## COMO RETOMAR EM CASA

```bash
# 1. Clonar / puxar o repositório
git pull origin master

# 2. Instalar dependências (usar pnpm na raiz)
npm install -g pnpm
pnpm install

# 3. Correr a app web
cd apps/web && npm run dev

# 4. Correr a app cliente no Expo Go
cd apps/cliente && npx expo start

# 5. Correr a app pro no Expo Go
cd apps/pro && npx expo start
```

> A base de dados Neon já tem todas as migrações aplicadas.
> Variáveis de ambiente em `.env.local` (não commitado — levar o ficheiro ou recriar com a string de ligação da Neon).
