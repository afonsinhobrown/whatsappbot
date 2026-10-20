-- Licenças pagas em cash: o admin actualiza a data-fim directamente no
-- sistema do cliente e fica aqui o talão de conferência correspondente.

CREATE TABLE IF NOT EXISTS licencas_cash (
  id                 BIGSERIAL PRIMARY KEY,
  referencia         TEXT UNIQUE NOT NULL,
  sistema            TEXT NOT NULL,
  conta_id           TEXT,
  conta_nome         TEXT NOT NULL,
  conta_email        TEXT,
  data_fim_anterior  TEXT,
  data_fim_nova      TEXT NOT NULL,
  valor              NUMERIC(12,2),
  observacao         TEXT,
  criado_em          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licencas_cash_criado ON licencas_cash (criado_em DESC);
