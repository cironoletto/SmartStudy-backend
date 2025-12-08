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

const { pool } = require("./db"); // <-- PostgreSQL pool

const app = express();
const PORT = process.env.PORT || 4000;

// ======================================================
// 🛠 MIDDLEWARE BASE
// ======================================================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(cors());

// Esposizione cartelle statiche
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

// Timeout esteso
app.use((req, res, next) => {
  res.setTimeout(120000); // 120 secondi
  next();
});

// ======================================================
// 📌 ROUTES API
// ======================================================
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/quiz", require("./routes/quizRoutes"));
app.use("/api/notes", require("./routes/notesRoutes"));
app.use("/api/questions", require("./routes/questionImageRoutes"));
app.use("/api/ocr", require("./routes/ocrRoutes"));
app.use("/api/study", require("./routes/studyRoutes")); // nuovo modulo

// ======================================================
// 🔍 DEBUG ROUTES (PostgreSQL version)
// ======================================================

// 🔧 Lista colonne Tabelle
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

// ======================================================
// 🔥 TEST BASE SERVER
// ======================================================
app.get("/", (req, res) =>
  res.send("SmartStudy Backend attivo su PostgreSQL 🚀")
);

// ======================================================
// 🚀 AVVIO SERVER
// ======================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});
