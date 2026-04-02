const db = require('./src/config/db');
async function check() {
    try {
        const [r] = await db.pool.query('SELECT total, numero_mesa, forma_pagamento, status FROM pedidos WHERE cliente_fone = "caos_mesa"');
        console.log("=== DADOS DO CAOS ===");
        console.log(JSON.stringify(r[0], null, 2));
    } catch(e) {
        console.error("ERRO:", e);
    } finally {
        process.exit(0);
    }
}
check();
