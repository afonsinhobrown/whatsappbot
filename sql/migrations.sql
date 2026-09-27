-- Ajustes ao schema existente (idempotente, pode correr várias vezes).

-- Subcategoria de produtos (ex: Produção Audiovisual, Design Gráfico).
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria VARCHAR(60);

-- Métodos de pagamento aceites pelo bot: e-Mola, M-Pesa, Visa.
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_metodo_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_metodo_check
  CHECK (metodo IN ('mpesa', 'emola', 'visa'));
