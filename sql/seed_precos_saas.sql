-- Preços de licença para todos os produtos SaaS (valores mensais).
-- Basic 3900 / Premium 6300 / Enterprise 10200 MZN. Idempotente.

UPDATE planos pl
SET preco = v.preco, periodo = 'mensal'
FROM produtos p,
     (VALUES ('Basic', 3900), ('Premium', 6300), ('Enterprise', 10200)) AS v(nome_plano, preco)
WHERE pl.produto_id = p.id
  AND p.tipo = 'saas'
  AND lower(pl.nome_plano) = lower(v.nome_plano);
