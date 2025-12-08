// db.js
require("dotenv").config();
const { Pool } = require("pg");

/* ----------------------------------------------------
   🔧 CONFIGURAZIONE POOL SCALABILE
   Usa DB_POOL_SIZE se presente,
   altrimenti setta automaticamente:
   - 20 connessioni in produzione
   - 5 connessioni in sviluppo
----------------------------------------------------- */
const MAX_POOL =
  process.env.DB_POOL_SIZE
    ? parseInt(process.env.DB_POOL_SIZE)
    : process.env.NODE_ENV === "production"
    ? 20
    : 5;

console.log(`🔧 PostgreSQL Pool Size: ${MAX_POOL}`);

/* ----------------------------------------------------
   🔌 CREAZIONE DEL POOL
   - SSL obbligatorio su Railway
   - timeout pensati per alte prestazioni
----------------------------------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: MAX_POOL,                  // numero massimo connessioni nel pool
  idleTimeoutMillis: 20000,       // chiude connessioni inutilizzate
  connectionTimeoutMillis: 5000,  // quanto aspettare una connessione libera
  ssl: {
    rejectUnauthorized: false,
  },
});

/* ----------------------------------------------------
   📡 LOG EVENTI DEL POOL
----------------------------------------------------- */
pool.on("connect", () => {
  console.log("🔌 Nuova connessione attiva al pool PostgreSQL");
});

pool.on("acquire", () => {
  console.log("📎 Connessione acquisita dal pool");
});

pool.on("remove", () => {
  console.log("❎ Connessione rimossa dal pool");
});

pool.on("error", (err) => {
  console.error("🔥 Errore nel pool PostgreSQL:", err);
});

/* ----------------------------------------------------
   🚀 API ESPORTATE
   - query() → per query semplici
   - getClient() → per transazioni
----------------------------------------------------- */

// Query rapida (consigliato per il 95% delle operazioni)
const query = (text, params) => {
  return pool.query(text, params);
};

// Connessione manuale (necessaria SOLO per transazioni)
const getClient = async () => {
  try {
    const client = await pool.connect();
    console.log("✔️ Connessione dedicata presa dal pool");
    return client;
  } catch (err) {
    console.error("❌ Errore ottenendo una connessione dal pool:", err);
    throw err;
  }
};

module.exports = {
  query,
  getClient,
  pool,
};
