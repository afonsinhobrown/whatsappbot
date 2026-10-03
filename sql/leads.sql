CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id),
  tenant_id INTEGER REFERENCES tenants(id),
  empresa VARCHAR(255),
  necessidade TEXT,
  urgencia VARCHAR(50),
  score INTEGER DEFAULT 0,
  estado VARCHAR(50) DEFAULT 'qualificacao',
  created_at TIMESTAMPTZ DEFAULT now()
);
