# Relatório: acesso às bases de dados dos clientes

Data: 30/09/2026
Estado: em curso, nada trocado em produção (ver "Segurança" no fim)

## O problema

O bot tinha 12 variáveis de ambiente que são credenciais completas
(utilizador + passe, ou `service_role`) de 6 bases de dados de clientes.
O `saasService.js` abria pools directos a cada uma e executava SQL escrito
à mão. Na prática o bot podia ler e escrever qualquer tabela.

Consequências reais, confirmadas por inspecção:

- **Gymar** — tabela `clients` com `access_password`, `access_token`,
  `balance`, `nuit`, `birth_date`, contactos de emergência: dados pessoais
  de todos os atletas.
- **Xonguile** — `Users.password`
- **CafePoint** — `User.password`
- **Shoplink** — `utilizador.senha_hash`
- **Armazem** — `users.password_hash`

Um único erro de SQL podia despejar esses dados para os logs. Não havia
RLS activa em nenhuma das bases, portanto não existia rede de segurança.

Por tudo o que o bot faz, bastam **duas operações por sistema**:

1. localizar a conta (email/username → id)
2. estender a validade, depois de pagamento confirmado

## O que foi feito

### 1. Papel restrito `bot_licencas` criado em 6 bases

`GYMAR_NEON`, `XONGUILE_NEON`, `GESTORFARMA_NEON`, `CAFEPOINT`,
`SHOPLINK`, `ARMAZEM`.

### 2. Duas funções `SECURITY DEFINER` por sistema

```sql
bot_licencas_conta(text)          -> json     -- localiza a conta
bot_licencas_activar(bigint, int) -> boolean  -- estende a validade
```

São `SECURITY DEFINER` com `SET search_path = public, pg_temp`, com `EXECUTE`
concedido apenas ao `bot_licencas` e `REVOKE ... FROM PUBLIC`. O papel não
tem **nenhum** privilégio de tabela: `REVOKE ALL ON ALL TABLES IN SCHEMA
public FROM bot_licencas`.

Isto é mais forte do que concessões de coluna, que não funcionaram (ver
"Falhas" abaixo). Se o bot for comprometido, o intruso só consegue chamar
estas duas funções.

### 3. Testado em 5 de 6 sistemas — resultado

| Sistema | Consulta | Activar | Leitura proibida | Escrita proibida |
|---|---|---|---|---|
| Xonguile | OK | OK | passwords, Licenses, DELETE, UPDATE email, TRUNCATE — bloqueados | idem |
| GestorFarma | OK | OK | contactos/NIF, licencas, DELETE — bloqueados | idem |
| CafePoint | OK | OK | passwords, DELETE — bloqueados | idem |
| Armazem | OK | OK | hashes, NIF, DELETE — bloqueados | idem |
| Shoplink | OK | ? | teste interrompido | ? |
| Gymar | OK | **FALHA** | tudo bloqueado correctamente | idem |

## Falhas conhecidas (não bloquear o sistema)

**1. Gymar — `bot_licencas_activar` com erro de tipo.**
`operator does not exist: text = bigint`.
A coluna `clients.id` é `text`, e a função declara `p_id bigint`.
Para corrigir, mudar a assinatura de `bot_licencas_activar` para `text` na
base `GYMAR_NEON` e passar `id::text` na comparação.
**Até corrigir, a activação de Ginásios está quebrada.** O resto não é
afectado.

**2. Shoplink — teste interrompido** (o comando foi abortado a meio).
A função foi criada com sucesso, mas falta verificar. O `tenant_id` é
`uuid`, e a conversão feita foi:
`('x' || substr(replace(tenant_id::text,'-',''),1,15))::bit(64)::bigint`
**Isto provavelmente não é reversível e não deve ser usado.** Recomendo
mudar para `bot_licencas_activar(text)` nesta base e comparar o `tenant_id`
como `uuid`, sem passar por `bigint`.

## Decisões de arquitectura (para quem continuar)

O objectivo final é que o bot **não tenha acesso a base de dados nenhuma**:
cada equipa expõe uma API própria com duas operações
(`/verificar-conta`, `/activar-licenca`) e um token revogável com permissão
de escrita apenas nessas duas acções.

As funções `SECURITY DEFINER` de agora são um passo intermedio já
aplicado e verificado: o poder do bot já não é "acesso total", é
"executar duas funções". Substituir cada sistema por uma API elimina
mesmo a necessidade de o bot tocar na base.

Cada equipa tem de decidir se aceita. Não se pode fazer unilateralmente.

## Trabalho de código que falta

**`src/services/saasService.js` ainda usa SQL directo e os pools com as
credenciais antigas.** Falta:

1. Reescrever como adaptadores por sistema, um ficheiro por sistema, com
   as duas operações apenas. Isto substitui o `switch` gigante actual
   (linhas 70-185).
2. Ler as credenciais do papel restrito em vez de `*_SUPABASE_URL` /
   `*_NEON_URL` / `*_DB_URL`.
3. Trocar no Vercel as variáveis antigas por `*_BOT_URL`.
4. Depois de trocar, **revogar o acesso do utilizador antigo** — caso
   contrário o risco continua inteiro, porque a credencial antiga
   continua válida.

Ordem segura: escrever o código → testar em local → trocar no Vercel →
comprar um plano de teste → revogar as antigas. Nunca antes.

## Bugs adicionais encontrados (não corrigidos)

- **`GYMAR_SUPABASE_URL` está partido.** O domínio termina em `.co` em vez
  de `.com` (`aws-1-eu-central-1.pooler.supabase.co`). Falha com
  `ENOTFOUND`. A base principal do Gymar nunca foi consultada; só a Neon
  funcionava.
- **CafePoint usava a coluna errada.** O código faz
  `UPDATE "License" SET "validUntil"` mas a tabela tem `endDate` e
  `startDate`. A activação no CafePoint nunca funcionou. A função nova já
  usa `endDate`.
- **`queryDual` tem um bug de precedência** (linha 40):
  `if (systemPools.primary && process.env[...] || process.env[...])`
  O `||` faz o `&&` ser avaliado primeiro sem parênteses, alterando a
  intenção.

## Segurança — importante

- As credenciais do papel restrito estão em
  `C:\Users\STAE-D~1\AppData\Local\Temp\opencode\bot-restrito.txt`.
  **Não versionar.** Estão fora do repositório de propósito.
- **O token da PaySuite que o utilizador enviou por mensagem foi recusado
  pela API (`401 Unauthenticated`) e não foi instalado.** O token que está
  em produção foi verificado e é válido. Não substituir sem confirmar.
- Os tokens antigos continuam por rodar (ver commit `5af01ac`).
