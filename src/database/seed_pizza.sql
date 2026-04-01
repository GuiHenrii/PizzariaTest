-- USE pizza_express_bot; -- O nome do banco pode ser ajustado no .env

-- Limpar dados antigos (CUIDADO: Use apenas em ambiente de desenvolvimento/setup)
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE produtos;
TRUNCATE TABLE categorias;
SET FOREIGN_KEY_CHECKS = 1;

-- =========================
-- 📂 CATEGORIAS
-- =========================
INSERT INTO categorias (id, nome) VALUES 
(1, 'Pizzas Tradicionais (8 fatias)'),
(2, 'Pizzas Especiais (8 fatias)'),
(3, 'Pizzas Doces (8 fatias)'),
(4, 'Bordas Recheadas'),
(5, 'Refrigerantes 2L'),
(6, 'Bebidas e Sucos');

-- =========================
-- 🧾 PRODUTOS
-- =========================
INSERT INTO produtos (id, categoria_id, nome, descricao, preco) VALUES

-- PIZZAS TRADICIONAIS (R$ 45,00)
(1, 1, 'Mussarela', 'Molho de tomate, mussarela, tomate e orégano', 45.00),
(2, 1, 'Calabresa', 'Molho de tomate, mussarela, calabresa fatiada, cebola e orégano', 45.00),
(3, 1, 'Portuguesa', 'Mussarela, presunto, ovos, cebola, ervilha, milho e azeitona', 48.00),
(4, 1, 'Marguerita', 'Mussarela, tomate fatiado, manjericão fresco e orégano', 45.00),
(5, 1, 'Frango com Catupiry', 'Frango desfiado temperado, coberto com legítimo Catupiry', 48.00),
(6, 1, 'Milho', 'Mussarela, milho selecionado e orégano', 42.00),
(7, 1, 'Napolitana', 'Mussarela, tomate e parmesão ralado', 45.00),

-- PIZZAS ESPECIAIS (R$ 55,00 - R$ 65,00)
(8, 2, 'Pepperoni', 'Mussarela, pepperoni fatiado e cebola', 55.00),
(9, 2, 'Quatro Queijos', 'Mussarela, catupiry, provolone e parmesão', 55.00),
(10, 2, 'Filé Mignon com Cheddar', 'Iscas de filé mignon, cebola e cobertura de cheddar', 65.00),
(11, 2, 'Bacon com Ovos', 'Mussarela, muito bacon crocante e ovos fatiados', 52.00),
(12, 2, 'Moda da Casa', 'Mussarela, presunto, bacon, milho, palmito e catupiry', 58.00),
(13, 2, 'Pantaneira', 'Mussarela, carne de sol, cebola roxa e pimenta biquinho', 58.00),

-- PIZZAS DOCES
(14, 3, 'Chocolate com Morango', 'Chocolate ao leite coberto com morangos frescos', 50.00),
(15, 3, 'Romeu e Julieta', 'Mussarela com goiabada cascão', 45.00),
(16, 3, 'Prestígio', 'Chocolate ao leite com coco ralado', 50.00),
(17, 3, 'Banana com Canela', 'Leite condensado, banana fatiada e canela em pó', 45.00),

-- BORDAS RECHEADAS
(18, 4, 'Borda de Catupiry', 'Adicional de borda recheada com Catupiry', 10.00),
(19, 4, 'Borda de Cheddar', 'Adicional de borda recheada com Cheddar', 10.00),
(20, 4, 'Borda de Chocolate', 'Adicional de borda recheada com Chocolate', 12.00),

-- REFRIGERANTES 2L
(21, 5, 'Coca-Cola 2L', 'Garrafa 2 Litros', 15.00),
(22, 5, 'Coca-Cola Zero 2L', 'Garrafa 2 Litros Sem Açúcar', 15.00),
(23, 5, 'Guaraná Antarctica 2L', 'Garrafa 2 Litros', 13.00),
(24, 5, 'Fanta Laranja 2L', 'Garrafa 2 Litros', 13.00),

-- BEBIDAS E SUCOS
(25, 6, 'Água Mineral 500ml', 'Sem Gás', 5.00),
(26, 6, 'Água Mineral com Gás 500ml', 'Garrafa', 6.00),
(27, 6, 'Suco de Laranja 500ml', 'Suco Natural', 10.00),
(28, 6, 'Cerveja Heineken LN', 'Long Neck', 12.00);
