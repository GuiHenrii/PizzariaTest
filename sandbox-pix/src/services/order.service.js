const db = require('../config/db');
const { printOrder } = require('./printer.service');
const paymentService = require('./payment.service');

async function processNewOrder(phone, orderData) {
    try {
        // 1. Achar ou criar cliente
        const [clientes] = await db.pool.query('SELECT id FROM clientes WHERE telefone = ?', [phone]);
        let clienteId;
        if (clientes.length === 0) {
            const [result] = await db.pool.query('INSERT INTO clientes (telefone) VALUES (?)', [phone]);
            clienteId = result.insertId;
        } else {
            clienteId = clientes[0].id;
        }

        // 2. Criar pedido
        const obs = orderData.observacao || '';
        const tp = orderData.tipo_pedido || 'entrega';
        const ender = orderData.endereco_entrega || '';
        const pag = orderData.forma_pagamento || '';
        
        const [pedidoRes] = await db.pool.query(
            'INSERT INTO pedidos (cliente_id, cliente_fone, tipo_pedido, endereco_entrega, forma_pagamento, numero_mesa, status, impresso) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [clienteId, phone, tp, ender, pag, orderData.numero_mesa || null, 'aberto', 2]
        );
        const pedidoId = pedidoRes.insertId;

        // 3. Adicionar itens e calcular total
        let subtotalProdutos = 0;
        let pTxtItens = "";

        for (const item of orderData.itens) {
            const [produtos] = await db.pool.query(`
                SELECT p.nome, p.preco, c.nome as categoria 
                FROM produtos p
                JOIN categorias c ON p.categoria_id = c.id
                WHERE p.id = ?
            `, [item.produto_id]);
            
            if (produtos.length > 0) {
                const p = produtos[0];
                const sub = p.preco * item.quantidade;
                subtotalProdutos += sub;
                await db.pool.query('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)', [pedidoId, item.produto_id, item.quantidade, p.preco]);
                pTxtItens += `${item.quantidade}x ${p.nome} (${p.categoria}) = R$ ${sub.toFixed(2)}\n`;
                if (item.observacao) {
                    pTxtItens += `   L-> Detalhe: ${item.observacao}\n`;
                }
            }
        }

        const taxaEntrega = orderData.tipo_pedido === 'entrega' ? 10.00 : 0;
        const totalGeral = subtotalProdutos + taxaEntrega;

        // 4. Montar Comanda Final
        let pTxt = `\n======= COMANDA =======\n`;
        pTxt += `TIPO: ${orderData.tipo_pedido ? orderData.tipo_pedido.toUpperCase() : 'NÃO INFORMADO'}\n`;
        
        if (orderData.tipo_pedido === 'entrega') {
            pTxt += `ENDEREÇO: ${orderData.endereco_entrega}\n`;
        }

        pTxt += `PAGAMENTO: ${orderData.forma_pagamento ? orderData.forma_pagamento.toUpperCase() : 'NÃO INFORMADO'}\n`;

        if (orderData.troco_para && Number(orderData.troco_para) > Number(totalGeral)) {
            const troco = Number(orderData.troco_para) - Number(totalGeral);
            pTxt += `TROCO PARA: R$ ${Number(orderData.troco_para).toFixed(2)}\n`;
            pTxt += `LEVAR TROCO DE: R$ ${troco.toFixed(2)}\n`;
        }

        pTxt += `--------------------------------\n`;
        pTxt += `ITENS:\n${pTxtItens}`;
        if (taxaEntrega > 0) pTxt += `\nTaxa de Entrega: R$ 10.00\n`;
        pTxt += `--------------------------------\n`;
        pTxt += `TOTAL A PAGAR: R$ ${totalGeral.toFixed(2)}\n`;
        pTxt += `OBS: ${obs}\n`;

        // Define se vai pra impressora imediatamente (0) ou aguarda liberação do webhook PIX (2)
        const isPix = orderData.forma_pagamento && orderData.forma_pagamento.toLowerCase().includes('pix');
        const statusImpressao = isPix ? 2 : 0; // 2 = bloqueado esperando pix
        const pagamentoStatus = isPix ? 'pendente' : 'pago';

        // Atribui total, resumo e tempo no DB CRM
        await db.pool.query(
            'UPDATE pedidos SET total = ?, resumo_itens = ?, observacao = ?, troco_para = ?, tempo_fechamento_segundos = ?, impresso = ?, pagamento_status = ? WHERE id = ?', 
            [totalGeral, pTxtItens, obs, orderData.troco_para || null, orderData.tempo_fechamento_segundos || 0, statusImpressao, pagamentoStatus, pedidoId]
        );

        // Se for PIX, gera QRCode e retorna pra camada do WhatsApp enviar
        let pixData = null;
        if (isPix && totalGeral > 0) {
            try {
                pixData = await paymentService.criarCobrancaPix(totalGeral, `Pedido #${pedidoId} - Leo Churrascaria`, pedidoId);
                // Salva o pagamento_id para o Webhook achar de volta
                if (pixData && pixData.id) {
                    await db.pool.query('UPDATE pedidos SET pagamento_id = ? WHERE id = ?', [pixData.id, pedidoId]);
                }
            } catch (err) {
                console.error("Erro ao gerar Pix no MP:", err);
            }
        }
        console.log(`[GERENCIADOR] Pedido #${pedidoId} salvo! Na fila esperando o Spooler Local puxar (ou esperando pagamento Pix).`);

        return { success: true, pedidoId, isPix, pixData, total: totalGeral };
    } catch (e) {
        console.error("Erro salvando pedido (mysql down?):", e.message);
        // Fallback for mock environment missing db
        await printOrder('MOCK', JSON.stringify(orderData, null, 2));
        return { success: false };
    }
}

// Também criamos uma função extra para o Webhook liberar o pedido na impressora
async function liberarImpressaoPix(paymentId) {
    try {
        const [pedidos] = await db.pool.query('SELECT id FROM pedidos WHERE pagamento_id = ? AND impresso = 2', [paymentId]);
        if (pedidos.length > 0) {
            await db.pool.query('UPDATE pedidos SET impresso = 0, pagamento_status = "pago" WHERE pagamento_id = ?', [paymentId]);
            return pedidos[0].id;
        }
        return null;
    } catch (e) {
        console.error("Erro liberarImpressaoPix:", e);
        return null;
    }
}

module.exports = { processNewOrder, liberarImpressaoPix };

