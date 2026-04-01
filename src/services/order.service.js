const db = require('../config/db');

async function processNewOrder(phone, orderData) {
    try {
        const [clientes] = await db.pool.query('SELECT id FROM clientes WHERE telefone = ?', [phone]);
        let clienteId = clientes.length > 0 ? clientes[0].id : (await db.pool.query('INSERT INTO clientes (telefone) VALUES (?)', [phone]))[0].insertId;

        const [pRes] = await db.pool.query(
            'INSERT INTO pedidos (cliente_id, cliente_fone, tipo_pedido, endereco_entrega, forma_pagamento, numero_mesa, status, impresso) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [clienteId, phone, orderData.tipo_pedido, orderData.endereco_entrega || '', orderData.forma_pagamento, orderData.numero_mesa || null, 'aberto', 2]
        );
        const pedidoId = pRes.insertId;

        let subtotal = 0; let pTxtItens = "";
        const [dbI] = await db.pool.query('SELECT p.id, p.nome, p.preco, c.id as cat_id FROM produtos p JOIN categorias c ON p.categoria_id = c.id WHERE p.id IN (?)', [orderData.itens.map(i => i.produto_id)]);

        const pizzas = []; const outros = [];
        orderData.itens.forEach(it => {
            const d = dbI.find(idx => idx.id === it.produto_id);
            if (d && [1, 2, 3].includes(d.cat_id)) pizzas.push({ ...it, db: d });
            else if (d) outros.push({ ...it, db: d });
        });

        // LÓGICA DE PRECIFICAÇÃO (SINCRONIA 100% COM AI SERVICE)
        const meias = pizzas.filter(p => p.quantidade === 0.5);
        const inteiras = pizzas.filter(p => p.quantidade === 1);

        if (meias.length >= 2) {
            let maiorV = 0; let nomes = "";
            for (const m of meias) {
                if (Number(m.db.preco) > maiorV) maiorV = Number(m.db.preco);
                nomes += m.db.nome + " / ";
                await db.pool.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)', [pedidoId, m.produto_id, 0.5, m.db.preco]);
            }
            subtotal += maiorV; pTxtItens += `1x Pizza Meia-Meia (${nomes.slice(0, -3)}) = R$ ${maiorV.toFixed(2)}\n`;
        } else if (meias.length === 1) {
            subtotal += Number(meias[0].db.preco); pTxtItens += `1x ${meias[0].db.nome} = R$ ${Number(meias[0].db.preco).toFixed(2)}\n`;
            await db.pool.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)', [pedidoId, meias[0].produto_id, 1, meias[0].db.preco]);
        }

        for (const p of inteiras) {
            subtotal += Number(p.db.preco); pTxtItens += `1x ${p.db.nome} = R$ ${Number(p.db.preco).toFixed(2)}\n`;
            await db.pool.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)', [pedidoId, p.produto_id, 1, p.db.preco]);
        }

        for (const o of outros) {
            const v = Number(o.db.preco) * o.quantidade; subtotal += v; pTxtItens += `${o.quantidade}x ${o.db.nome} = R$ ${v.toFixed(2)}\n`;
            await db.pool.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)', [pedidoId, o.produto_id, o.quantidade, o.db.preco]);
        }

        const end = (orderData.endereco_entrega || orderData.endereco || "").toLowerCase();
        const temEnd = end.includes("rua") || end.includes("-17.753") || end.includes("lote") || end.includes("quadra");
        const taxa = (orderData.tipo_pedido === 'entrega' && temEnd) ? 10 : 0;
        const total = subtotal + taxa;

        let pTxt = `\n======= COMANDA =======\nTIPO: ${orderData.tipo_pedido.toUpperCase()}\n`;
        if (orderData.tipo_pedido === 'entrega') pTxt += `ENDEREÇO: ${orderData.endereco_entrega || orderData.endereco}\n`;
        pTxt += `PAGAMENTO: ${orderData.forma_pagamento.toUpperCase()}\n`;
        if (orderData.troco_para > total) pTxt += `TROCO PARA: R$ ${Number(orderData.troco_para).toFixed(2)}\nLEVAR: R$ ${(orderData.troco_para - total).toFixed(2)}\n`;
        pTxt += `ITENS:\n${pTxtItens}${taxa > 0 ? '+ Taxa de Entrega: R$ 10.00\n' : ''}----------------------\nTOTAL A PAGAR: R$ ${total.toFixed(2)}\n`;

        await db.pool.query('UPDATE pedidos SET total = ?, resumo_itens = ?, troco_para = ?, tempo_fechamento_segundos = ?, impresso = 0 WHERE id = ?', 
            [total, pTxtItens, orderData.troco_para || null, orderData.tempo_fechamento_segundos || 0, pedidoId]
        );
        return true;
    } catch (e) { console.error("Erro processNewOrder:", e.message); return false; }
}

module.exports = { processNewOrder };
