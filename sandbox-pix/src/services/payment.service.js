const { MercadoPagoConfig, Payment } = require('mercadopago');

let mpClient = null;
let payment = null;

function getMPClient() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token || token.includes("SEU_TOKEN_AQUI")) return null;
    
    if (!mpClient) {
        mpClient = new MercadoPagoConfig({ accessToken: token, options: { timeout: 10000 } });
        payment = new Payment(mpClient);
    }
    return payment;
}

/**
 * Cria uma cobrança PIX automática no MercadoPago.
 */
async function criarCobrancaPix(amount, description, orderId) {
    const apiPayment = getMPClient();

    if (!apiPayment) {
        console.warn("⚠️ [MERCADO PAGO] Token não configurado. Simulando PIX Fake no Sandbox...");
        return {
            id: Date.now(),
            qr_code: "00020101021226BR.GOV.BCB.PIX...ESTE_E_UM_PIX_FALSO_DE_TESTE",
            qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            isFake: true
        };
    }

    try {
        const idempotencyKey = String(Date.now() + Math.random());
        const response = await apiPayment.create({
            body: {
                transaction_amount: Number(amount),
                description: description,
                payment_method_id: 'pix',
                payer: { 
                    email: `cliente_${orderId}@churrascaria.bot`,
                    first_name: "Cliente",
                    last_name: "Léo Churrascaria",
                    identification: { type: "CPF", number: "19119119100" }
                },
                external_reference: String(orderId)
            },
            requestOptions: { idempotencyKey }
        });
        
        return {
            id: response.id,
            qr_code: response.point_of_interaction?.transaction_data?.qr_code,
            qr_code_base64: response.point_of_interaction?.transaction_data?.qr_code_base64,
            isFake: false
        };
    } catch (e) {
        console.error("❌ Erro da API do Mercado Pago ao gerar PIX:", e.message);
        return null;
    }
}

async function consultarStatus(paymentId) {
    const apiPayment = getMPClient();
    if (!apiPayment) {
        console.error("❌ Erro: Tentativa de consultar Pix sem Token de Acesso configurado!");
        return "error"; 
    }
    
    try {
        const response = await apiPayment.get({ id: paymentId });
        return response.status; 
    } catch (e) {
        console.error(`❌ Erro ao consultar PIX ID ${paymentId}:`, e.message);
        return "error";
    }
}

module.exports = {
    criarCobrancaPix,
    consultarStatus
};
