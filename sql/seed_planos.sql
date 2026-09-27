-- Tipos de licença (planos) para os produtos SaaS.
-- Basic / Premium / Enterprise. Preços a 0 para o admin preencher.
-- Idempotente: não duplica se o plano já existe para o produto.

INSERT INTO planos (produto_id, nome_plano, preco, moeda, periodo, ativo)
SELECT p.id, v.nome_plano, 0, 'MZN', NULL, true
FROM produtos p
CROSS JOIN (VALUES ('Basic'), ('Premium'), ('Enterprise')) AS v(nome_plano)
WHERE p.tipo = 'saas'
  AND NOT EXISTS (
    SELECT 1 FROM planos pl
     WHERE pl.produto_id = p.id
       AND lower(pl.nome_plano) = lower(v.nome_plano)
  );
