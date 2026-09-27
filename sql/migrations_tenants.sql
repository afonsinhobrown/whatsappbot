-- Multi-tenant: cada "tenant" e um negocio com o seu bot.
-- O tenant da TECNOINCUBADORA usa a infra actual (env) mas fica na BD para
-- permitir criar bots para outros clientes.

CREATE TABLE IF NOT EXISTS tenants (
  id               SERIAL PRIMARY KEY,
  nome             VARCHAR(120) NOT NULL,
  phone_number_id  VARCHAR(40),
  waba_id          VARCHAR(40),
  token            TEXT,
  ativo            BOOLEAN DEFAULT true,
  config           JSONB DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Tenant da TECNOINCUBADORA (idempotente)
-- phone_number_id: 1349279428267688  (numero +258 86 139 0985)
-- waba_id:         1050705194450386
INSERT INTO tenants (nome, phone_number_id, waba_id, ativo)
SELECT 'TECNOINCUBADORA', '1349279428267688', '1050705194450386', true
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE phone_number_id = '1349279428267688');

-- Adicionar tenant_id as tabelas de negocio
ALTER TABLE produtos    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE planos      ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE clientes    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE licencas    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE cotacoes    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE orcamentos  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE encomendas  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE pagamentos  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE bot_sessoes ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);

-- Backfill: tudo o que ja existe pertence a TECNOINCUBADORA
UPDATE produtos    SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE planos      SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE clientes    SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE licencas    SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE cotacoes    SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE orcamentos  SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE encomendas  SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE pagamentos  SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
UPDATE bot_sessoes SET tenant_id = (SELECT id FROM tenants WHERE phone_number_id='1349279428267688') WHERE tenant_id IS NULL;
