const { OpenAI } = require('openai');
const db = require('../config/db');
const orderService = require('./order.service');
require('dotenv').config();

const openai = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY,
});

const menuCache = { categorias: null, itensPorCategoria: {}, textoCategorias: null };

async function carregarCategorias() {
    if (menuCache.categorias) return; 
    const [rows] = await db.pool.query('SELECT id, nome FROM categorias ORDER BY id');
    menuCache.categorias = rows;
    let txt = '🍕 *Cardápio Pizza Express* 🍕\n\nEscolha uma categoria:\n\n';
    rows.forEach((c) => { txt += `🍕 ${c.nome}\n`; });
    txt += '\nOu já me diz o que você vai querer! 😊';
    menuCache.textoCategorias = txt;
}

async function getAllItensParaIA() {
    const [rows] = await db.pool.query('SELECT p.id, p.nome, p.preco, p.disponivel, p.descricao, c.nome as categoria FROM produtos p JOIN categorias c ON p.categoria_id = c.id ORDER BY c.id, p.nome');
    let menuTxt = "CARDÁPIO OFICIAL (CONFIRA O ID PELO NOME):\n";
    rows.forEach(r => {
        menuTxt += `ID:${r.id} | NOME:${r.nome} | CATEGORIA:${r.categoria} | PREÇO:R$${Number(r.preco).toFixed(2)}${r.disponivel ? '' : ' [ESGOTADO]'}\n`;
    });
    return menuTxt;
}

const SYSTEM_PROMPT = `Você é o AGENTE DE VENDAS PRO da Pizza Express.
PERSONALIDADE: Direto e ágil.

REGRAS TÉCNICAS (CONFERÊNCIA):
1. MAPEAMENTO DE ID: Localize o NOME exato no Cardápio e use APENAS o ID correspondente. NÃO alucine IDs.
2. MEIA-MEIA: Metade de sabor A e sabor B = quantidade 0.5 para cada. Válido apenas para Pizzas.
3. BEBIDAS: Bebidas são itens à parte (qty 1.0+).

ORDEM OBRIGATÓRIA (LEIS):
1. ANOTE ITENS: Sabores e bebidas. Se não houver bebida, sugira: "Gostaria de uma Coca ou suco?".
2. MODALIDADE: "Entrega, retirada ou mesa?".
3. LOCAL: Se entrega, PEÇA O ENDEREÇO. 🚨 PROIBIDO resumo sem endereço se for entrega.
4. RESUMO: Chame 'obter_resumo_financeiro'. Peça confirmação.
5. PAGAMENTO: "Pix, Cartão ou Dinheiro?".
6. TROCO: Se dinheiro, pergunte: "precisa de troco pra qual valor?". 🚨 APÓS o usuário informar o valor, chame IMEDIATAMENTE 'finalizar_pedido' com o troco calculado. NÃO pergunte se pode finalizar.
7. FINALIZAR: Chame 'finalizar_pedido' para encerrar.

COORDENADAS LOJA: -17.7539148, -48.6388202. JAMAIS cite IDs técnicos.`;

const sessions = {};

async function processMessage(phone, text) {
    if (!sessions[phone]) {
        sessions[phone] = [{ role: "system", content: SYSTEM_PROMPT }];
        sessions[phone].startTime = Date.now();
        sessions[phone].menuInjetado = false;
    }
    await carregarCategorias();
    if (!sessions[phone].menuInjetado) {
        sessions[phone].push({ role: "user", content: "[SISTEMA] Cardápio:\n" + await getAllItensParaIA() });
        sessions[phone].push({ role: "assistant", content: "[OK]" });
        sessions[phone].menuInjetado = true;
    }
    sessions[phone].push({ role: "user", content: text });

    for (let i = 0; i < 3; i++) {
        // Trava de Segurança: Só libera a finalização se o resumo financeiro já foi gerado na sessão
        const jaTeveResumo = sessions[phone].some(m => m.role === 'tool' && m.content && (m.content.includes('*RESUMO*') || m.content.includes('TOTAL')));
        
        const tools = [{
            type: "function",
            function: {
                name: "obter_resumo_financeiro",
                description: "Calcula o total financeiro. REQUER obrigatoriamente a modalidade (entrega/retirada/mesa) e o endereço completo (se for entrega).",
                parameters: {
                    type: "object",
                    properties: {
                        itens: { type: "array", items: { type: "object", properties: { produto_id: { type: "integer" }, quantidade: { type: "number" } }, required: ["produto_id", "quantidade"] } },
                        tipo_pedido: { type: "string", enum: ["entrega", "retirada", "mesa"] }
                    },
                    required: ["itens", "tipo_pedido"]
                }
            }
        }];

        if (jaTeveResumo) {
            tools.push({
                type: "function",
                function: {
                    name: "finalizar_pedido",
                    description: "AÇÃO OBRIGATÓRIA: Registra o pedido no banco. Chame IMEDIATAMENTE após o cliente confirmar forma de pagamento e troco.",
                    parameters: {
                        type: "object",
                        properties: {
                            itens: { type: "array", items: { type: "object", properties: { produto_id: { type: "integer" }, quantidade: { type: "number" } } } },
                            tipo_pedido: { type: "string", enum: ["entrega", "retirada", "mesa"] },
                            endereco_entrega: { type: "string" },
                            forma_pagamento: { type: "string", enum: ["pix", "cartão", "dinheiro"] },
                            troco_para: { type: "number", description: "Valor total da nota que o cliente deu (Ex: 100.00). Use apenas se for dinheiro." },
                            numero_mesa: { type: "string" },
                            observacao: { type: "string" }
                        },
                        required: ["itens", "tipo_pedido", "forma_pagamento"]
                    }
                }
            });
        }

        const response = await openai.chat.completions.create({ model: "llama-3.3-70b-versatile", messages: sessions[phone], tools, tool_choice: "auto", temperature: 0.1 });
        const message = response.choices[0].message;
        if (message.content && !message.tool_calls) sessions[phone].push(message);

        if (message.tool_calls) {
            sessions[phone].push(message);
            const toolCall = message.tool_calls[0];
            const action = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments || "{}");

            if (action === 'obter_resumo_financeiro') {
                const userT = sessions[phone].filter(m => m.role === 'user').map(m => m.content).join(" ").toLowerCase();
                
                // BLOQUEIO DE SUPOSIÇÃO: Se o usuário não disse explicitamente o modo, force a pergunta.
                const temModalidade = userT.includes("entrega") || userT.includes("retira") || userT.includes("mesa") || userT.includes("balcão");
                if (!temModalidade) {
                    const err = "ERRO: Você está assumindo a modalidade! Pergunte primeiro: 'Será para entrega, retirada ou mesa?'.";
                    sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: err });
                    continue;
                }

                const temE = userT.includes("rua") || userT.includes("-17.753") || userT.includes("lote") || userT.includes("quadra");
                if (args.tipo_pedido === 'entrega' && !temE) {
                    const err = "ERRO: Você ainda não tem o endereço! Peça o endereço antes de mostrar o resumo.";
                    sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: err });
                    continue;
                }
                const res = await handleObterResumo(args, phone);
                sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: res.resumo });
                return { isOrderCompleted: false, replyText: res.resumo + "\n\nConfirma o pedido? (Sim/Não)" };
            }

            if (action === 'finalizar_pedido') {
                // FALLBACK DE TROCO: Se a IA esqueceu o argumento mas o usuário informou na conversa
                if (args.forma_pagamento === 'dinheiro' && (!args.troco_para || args.troco_para === 0)) {
                    const chatLog = sessions[phone].filter(m => m.role === 'user').map(m => m.content).join(" ");
                    const match = chatLog.match(/troco\s*(?:para|pra)?\s*(\d+)/i);
                    if (match) args.troco_para = Number(match[1]);
                }

                // FALLBACK DE MESA: Evita amnésia da IA sob estresse
                if (args.tipo_pedido === 'mesa' && (!args.numero_mesa || args.numero_mesa.trim() === '')) {
                    const chatLog = sessions[phone].filter(m => m.role === 'user').map(m => m.content).join(" ").toLowerCase();
                    // Captura 'mesa 5', 'mesa 10', 'mesa 02'
                    const matchMesa = chatLog.match(/mesa\s*(\d+)/i);
                    if (matchMesa) {
                        args.numero_mesa = matchMesa[1];
                    } else {
                        const err = "ERRO: O cliente está na mesa, mas você esqueceu de perguntar ou preencher QUAL É O NÚMERO DA MESA. Pergunte agora e não finalize sem isso!";
                        sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: err });
                        continue;
                    }
                }

                if (args.forma_pagamento === 'dinheiro' && (!args.troco_para || args.troco_para === 0)) {
                    const realChat = sessions[phone].filter(m => m.role !== 'system').map(m => m.content).join(" ").toLowerCase();
                    if (!realChat.includes("troco")) {
                        const err = "ERRO: O cliente escolheu DINHEIRO! Você DEVE perguntar 'precisa de troco pra qual valor?' antes de finalizar.";
                        sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: err });
                        continue;
                    }
                }
                args.tempo_fechamento_segundos = Math.round((Date.now() - sessions[phone].startTime) / 1000);
                const res = await orderService.processNewOrder(phone, args);
                if (!res) {
                    sessions[phone].push({ role: "tool", tool_call_id: toolCall.id, content: "Erro interno ao processar pedido no banco. Tente novamente." });
                    continue;
                }
                
                delete sessions[phone];
                return { isOrderCompleted: true, orderData: args, replyText: "Pedido confirmado! 🍕🔥" };
            }
        }
        return { isOrderCompleted: false, replyText: message.content || "Como posso ajudar?" };
    }
}

async function handleObterResumo({ itens, tipo_pedido }, phone) {
    const ids = [...new Set(itens.map(i => i.produto_id))];
    const [dbItens] = await db.pool.query('SELECT p.id, p.nome, p.preco, c.id as cat_id FROM produtos p JOIN categorias c ON p.categoria_id = c.id WHERE p.id IN (?)', [ids]);
    let sub = 0; let pTxt = ""; const pizzas = []; const outros = [];
    itens.forEach(it => {
        const d = dbItens.find(x => x.id === it.produto_id);
        if (d && [1, 2, 3].includes(d.cat_id)) pizzas.push({ ...it, db: d });
        else if (d) outros.push({ ...it, db: d });
    });
    if (pizzas.length === 2 && pizzas.every(p => p.quantidade === 1)) {
        if (JSON.stringify(sessions[phone]).toLowerCase().match(/meia|metade/)) pizzas.forEach(p => p.quantidade = 0.5);
    }
    const meias = pizzas.filter(p => p.quantidade === 0.5);
    const inteiras = pizzas.filter(p => p.quantidade === 1);
    if (meias.length >= 2) {
        let max = 0; let n = ""; meias.forEach(m => { if (Number(m.db.preco) > max) max = Number(m.db.preco); n += m.db.nome + " / "; });
        sub += max; pTxt += `1x Pizza Meia-Meia (${n.slice(0, -3)}) = R$ ${max.toFixed(2)}\n`;
    } else if (meias.length === 1) { sub += Number(meias[0].db.preco); pTxt += `1x ${meias[0].db.nome} = R$ ${Number(meias[0].db.preco).toFixed(2)}\n`; }
    inteiras.forEach(p => { sub += Number(p.db.preco); pTxt += `1x ${p.db.nome} = R$ ${Number(p.db.preco).toFixed(2)}\n`; });
    outros.forEach(o => { const v = Number(o.db.preco) * o.quantidade; sub += v; pTxt += `${o.quantidade}x ${o.db.nome} = R$ ${v.toFixed(2)}\n`; });
    const uText = sessions[phone].filter(m => m.role === 'user').map(m => m.content).join(" ").toLowerCase();
    const taxa = (tipo_pedido === 'entrega' && (uText.includes("rua") || uText.includes("-17.753") || uText.includes("lote"))) ? 10 : 0;
    return { resumo: `📄 *RESUMO*\n\n${pTxt}${taxa > 0 ? '🛵 Taxa: R$ 10.00\n' : ''}\n💰 *TOTAL: R$ ${(sub + taxa).toFixed(2)}*` };
}

// EXPORTAÇÕES OBRIGATÓRIAS PARA O TESTE E SISTEMA
async function transcribeAudio(b64) { try { const fs = require('fs'); const path = require('path'); const os = require('os'); const t = path.join(os.tmpdir(), `a_${Date.now()}.ogg`); fs.writeFileSync(t, Buffer.from(b64, 'base64')); const r = await openai.audio.transcriptions.create({ file: fs.createReadStream(t), model: "whisper-large-v3", language: "pt" }); fs.unlinkSync(t); return r.text; } catch (e) { return "[Audio]"; } }
async function describeImage(b64, mt) { try { const r = await openai.chat.completions.create({ model: "llama-3.2-11b-vision-preview", messages: [{ role: "user", content: [{ type: "text", text: "Descreva a imagem." }, { type: "image_url", image_url: { url: `data:${mt};base64,${b64}` } }] }] }); return `[Imagem: ${r.choices[0].message.content}]`; } catch (e) { return "[Imagem]"; } }
function injectSystemMessage(phone, text) { if (sessions[phone]) sessions[phone].push({ role: "system", content: text }); }
function initSession(phone, force = false) { if (!sessions[phone] || force) { sessions[phone] = [{ role: "system", content: SYSTEM_PROMPT }]; sessions[phone].startTime = Date.now(); sessions[phone].menuInjetado = false; } }
function hasActiveSession(phone) { return !!sessions[phone]; }

module.exports = { processMessage, transcribeAudio, describeImage, injectSystemMessage, initSession, hasActiveSession };
