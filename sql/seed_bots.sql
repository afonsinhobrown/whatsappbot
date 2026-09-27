-- Produto do tipo "bot" com planos Basic (3000/mês) e Premium (5000/mês).
-- Idempotente.

INSERT INTO produtos (tipo, categoria, nome, descricao, ativo)
SELECT 'bot', 'Bots', 'Bot WhatsApp', 'Automação de atendimento no WhatsApp.', true
WHERE NOT EXISTS (
  SELECT 1 FROM produtos WHERE tipo = 'bot' AND nome = 'Bot WhatsApp'
);

INSERT INTO planos (produto_id, nome_plano, preco, moeda, periodo, ativo)
SELECT p.id, v.nome_plano, v.preco, 'MZN', 'mensal', true
FROM produtos p
CROSS JOIN (VALUES ('Basic', 3000), ('Premium', 5000)) AS v(nome_plano, preco)
WHERE p.tipo = 'bot' AND p.nome = 'Bot WhatsApp'
  AND NOT EXISTS (
    SELECT 1 FROM planos pl
     WHERE pl.produto_id = p.id
       AND lower(pl.nome_plano) = lower(v.nome_plano)
  );
