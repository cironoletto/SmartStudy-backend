// ======================================================
// 🌱 LOAD ENV
// ======================================================
require("dotenv").config();

console.log("ENV CHECK:", {
  OPENAI: process.env.OPENAI_API_KEY ? "LOADED" : "MISSING",
  DB: process.env.DATABASE_URL ? "LOADED" : "MISSING"
});

// ======================================================
// 📦 IMPORTS
// ======================================================
const express = require("express");
const cors = require("cors");
const path = require("path");

const { pool } = require("./db"); // PostgreSQL pool

const app = express();

// 🚨 IMPORTANTISSIMO: Railway NON permette default !!!  
// Devi usare SOLO process.env.PORT
const PORT = process.env.PORT;

// ======================================================
// 🛠 CORS CONFIG
// ======================================================
app.use(cors({
  origin: "*",
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization"
}));

// ======================================================
// 🛠 MIDDLEWARE BASE
// ======================================================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Static files
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// Timeout
app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});

// ======================================================
// 📌 ROUTES
// ======================================================
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/quiz", require("./routes/quizRoutes"));
app.use("/api/study", require("./routes/studyRoutes"));
app.use("/api/limits", require("./routes/limitsRoutes"));
app.use("/api/subscription", require("./routes/subscriptionRoutes"));

// ======================================================
// 🔍 DEBUG
// ======================================================
if (process.env.NODE_ENV !== "production") {
app.get("/debug/columns/:table", async (req, res) => {
    try {
      const table = req.params.table;
      const result = await pool.query(
        `SELECT column_name
 FROM information_schema.columns
         WHERE table_name = $1`,
        [table.toLowerCase()]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("DEBUG ERROR:", err);
      res.status(500).json({ error: "Errore debug colonne" });
    }
  });
}


// ======================================================
// 🔥 TEST BASE
// ======================================================
app.get("/", (req, res) =>
  res.send("SmartStudy Backend attivo su PostgreSQL 🚀")
);

// ======================================================
// DATABASE - PASSWORD RESET SCHEMA
// ======================================================

async function ensurePasswordResetSchema() {
  console.log("Verifica schema recupero password...");

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email VARCHAR(320)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower
    ON users (LOWER(email))
    WHERE email IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      resetid BIGSERIAL PRIMARY KEY,
      userid BIGINT NOT NULL REFERENCES users(userid) ON DELETE CASCADE,
      codehash VARCHAR(64) NOT NULL,
      expiresat TIMESTAMPTZ NOT NULL,
      attemptcount INTEGER NOT NULL DEFAULT 0,
      usedat TIMESTAMPTZ NULL,
      createdat TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_password_reset_codes_user_active
    ON password_reset_codes (userid, createdat DESC)
  `);

  console.log("Schema recupero password pronto");
}

// ======================================================
// AVVIO SERVER
// ======================================================

async function startServer() {
  try {
    await ensurePasswordResetSchema();
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS free_trial_ends_at TIMESTAMPTZ
      NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '168 hours')
    `);

    await pool.query(`
      ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS scientific_solution JSONB
    `);

    app.listen(PORT, () => {
      console.log(`Server avviato correttamente sulla porta ${PORT}`);
    });
  } catch (err) {
    console.error("Errore inizializzazione database:", err);
    process.exit(1);
  }
}

startServer();
