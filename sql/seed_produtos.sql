-- Catálogo inicial de produtos/serviços da TECNOINCUBADORA
-- Idempotente: pode ser corrido várias vezes sem duplicar (por nome).
--
-- O campo `tipo` está limitado por CHECK a: saas | bot | plugin | servico_custom.
-- As subcategorias (ex: Audiovisual, Design) vão na coluna `categoria`.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria VARCHAR(60);

INSERT INTO produtos (tipo, categoria, nome, descricao, ativo)
SELECT v.tipo, v.categoria, v.nome, v.descricao, true
FROM (VALUES
  -- ===== SaaS =====
  ('saas', 'SaaS', 'Xonguile',            'Gestão de salões de beleza.'),
  ('saas', 'SaaS', 'Gymar',               'Gestão de ginásios e academias.'),
  ('saas', 'SaaS', 'Adegahub',            'Sistema para adegas e venda de bebidas.'),
  ('saas', 'SaaS', 'Shoplink',            'Loja online com catálogo e link de venda.'),
  ('saas', 'SaaS', 'TurboIA',             'Plataforma para formações em IA.'),
  ('saas', 'SaaS', 'Cafe Point',          'Gestão de cafés, bares e restaurantes.'),
  ('saas', 'SaaS', 'GestorFarma',         'Gestão de farmácias.'),
  ('saas', 'SaaS', 'CrediHub',            'Gestão de crédito e cobranças.'),
  ('saas', 'SaaS', 'BrokersHub',          'Gestão para corretores e brokers.'),
  ('saas', 'SaaS', 'Gamerz',              'Gestão de lojas e espaços de gaming.'),
  ('saas', 'SaaS', 'Smart Warehouse WMS', 'Gestão de armazém (WMS).'),
  ('saas', 'SaaS', 'SmartSchoolMZ',       'Gestão escolar.'),

  -- ===== Serviços: Produção Audiovisual =====
  ('servico_custom', 'Produção Audiovisual', 'Produção de Vídeos',            'Produção de vídeos institucionais e comerciais.'),
  ('servico_custom', 'Produção Audiovisual', 'Produção de Documentários',     'Produção de documentários.'),
  ('servico_custom', 'Produção Audiovisual', 'Produção de Vídeo Musical',     'Produção de videoclipes e vídeo musical.'),
  ('servico_custom', 'Produção Audiovisual', 'Produção de Publicidade',       'Produção de peças publicitárias.'),
  ('servico_custom', 'Produção Audiovisual', 'Produção de Filmes e Seriados', 'Produção de filmes e séries.'),

  -- ===== Serviços: Design Gráfico =====
  ('servico_custom', 'Design Gráfico', 'Produção de Cartazes', 'Criação e produção de cartazes.'),
  ('servico_custom', 'Design Gráfico', 'Produção de Logos',    'Criação de logótipos e identidade visual.'),

  -- ===== Serviços: Sinalética Digital =====
  ('servico_custom', 'Sinalética Digital', 'Produção de Digital Boards', 'Produção de conteúdos para ecrãs/quadros digitais.'),

  -- ===== Serviços: Formação em IA =====
  ('servico_custom', 'Formação em IA', 'AI Training', 'Formação e capacitação em inteligência artificial.')
) AS v(tipo, categoria, nome, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM produtos p WHERE p.nome = v.nome
);
