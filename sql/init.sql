-- Script para correr no Neon (SQL Editor) na primeira vez

CREATE TABLE IF NOT EXISTS clientes (
  id          SERIAL PRIMARY KEY,
  phone       VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  product     VARCHAR(50),
  balance     NUMERIC(14, 2) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Exemplos de registos de teste (remova em produção)
INSERT INTO clientes (phone, name, product, balance) VALUES
  ('258840000001', 'Ana',    'CredHubMZ', 15000.00),
  ('258840000002', 'Carlos', 'Xonguile',    350.00),
  ('258840000003', 'Marta',  'Gymar',      8700.50)
ON CONFLICT (phone) DO NOTHING;
