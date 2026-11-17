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
// 🚀 AVVIO SERVER (CORRETTO PER RAILWAY)
// ======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server avviato correttamente sulla porta ${PORT}`);
});
