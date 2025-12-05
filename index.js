// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getConnection } = require("./db");

const app = express();

const PORT = process.env.PORT || 4000;


app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/audio", express.static(path.join(__dirname, "audio")));


// ⬇ aumenta timeout server
app.use((req, res, next) => {
  res.setTimeout(120000); // 120 secondi
  next();
});



// Middleware generali
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Routes API ---
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/quiz", require("./routes/quizRoutes"));
app.use("/api/notes", require("./routes/notesRoutes"));
app.use("/api/questions", require("./routes/questionImageRoutes"));
app.use("/api/ocr", require("./routes/ocrRoutes"));

// 👉 NUOVA ROUTE STUDY (riassunto, scientifico, orale)
app.use("/api/study", require("./routes/studyRoutes"));



app.get("/debug/columns", async (req, res) => {
  const { getConnection } = require("./db");
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Questions'
  `);
  res.json(result.recordset);
});

app.get("/debug/quiz", async (req, res) => {
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Quiz'
  `);
  res.json(result.recordset);
});

app.get("/debug/answers", async (req, res) => {
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Answers'
  `);
  res.json(result.recordset);
});

app.get("/debug/quizzes-columns", async (req, res) => {
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Quizzes'
    ORDER BY COLUMN_NAME
  `);
  res.json(result.recordset);
});


app.get("/debug/attempts", async (req, res) => {
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Attempts'
  `);
  res.json(result.recordset);
});


// Rotta test base
app.get("/", (req, res) =>
  res.send("Server Express + SQL Server con MVC funzionante!")
);

// Avvio server
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server su http://localhost:${PORT}`)
);