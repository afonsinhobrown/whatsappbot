-- Pagamento automático: a partir de agora o cliente paga numa página
-- da PaySuite e a licença é activada quando o pagamento é confirmado.

-- Referência do pedido na PaySuite + link da página de pagamento.
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS paysuite_id TEXT;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS paysuite_checkout_url TEXT;

-- Conta do cliente no sistema SaaS que a licença activa (email, id de ginásio...).
ALTER TABLE licencas ADD COLUMN IF NOT EXISTS dados_conta JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pagamentos_paysuite ON pagamentos (paysuite_id);
