// db.js
const sql = require("mssql");
//require("dotenv").config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool = null;

module.exports = {
  sql,

  getConnection: async () => {
    if (pool) return pool;

    console.log("➡️ Primo collegamento a SQL Server...");
    console.log(config);

    try {
      pool = await sql.connect(config);
      console.log("✔️ Connessione stabilita");
      return pool;
    } catch (err) {
      console.error("❌ Errore connessione DB:", err);
      throw err;
    }
  },
};
