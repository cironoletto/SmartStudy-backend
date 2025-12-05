// controllers/studyController.js
const fs = require("fs");
const sql = require("mssql");
const db = require("../db");

const ocrService = require("../services/ocrService");
const aiService = require("../services/aiService");

const { generateSummaryAudio } = require("../services/elevenlabsService");


/* ===========================================================
   📸 PROCESS IMAGES → OCR → AI
   =========================================================== */
exports.processFromImages = async (req, res) => {
  try {
    console.log("-----------------------------");
    console.log("📥 STUDY FROM IMAGES - DEBUG");
    console.log("👉 req.body:", req.body);
    console.log("👉 req.files:", req.files);
    console.log("-----------------------------");

    const userID = req.user?.userId;
    if (!userID) {
      return res.status(401).json({ error: "Utente non autenticato" });
    }

    const mode = (req.body.mode || "summary").toLowerCase();
    const files = req.files || [];

    if (!files.length) {
      console.log("❌ Multer NON riceve file!");
      return res.status(400).json({ error: "Nessuna immagine fornita" });
    }

    /* 1️⃣ OCR */
    const rawText = await ocrService.extractTextFromImages(files);

    if (!rawText || !rawText.trim()) {
      console.log("❌ OCR NON HA TROVATO TESTO");
      return res.status(400).json({ error: "Testo non riconosciuto" });
    }

    const pool = await db.getConnection();

    /* 2️⃣ Salva sessione */
 const qSession = await pool
  .request()
  .input("UserID", sql.Int, userID)
  .input("Subject", sql.VarChar(120), req.body.subject || null)
  .input("Type", sql.NVarChar(100), mode)  // 👈 FIX
  .input("RawText", sql.NVarChar(sql.MAX), rawText)
  .query(`
    INSERT INTO study_sessions (userID, subject, type, rawText, createdAt)
    OUTPUT INSERTED.sessionID
    VALUES (@UserID, @Subject, @Type, @RawText, GETDATE())
  `);


    const sessionID = qSession.recordset[0].sessionID;

    let payload = { sessionID };

    /* 3️⃣ Elaborazioni AI in base alla modalità */
   if (mode === "summary") {
  const summary = await aiService.generateSummary(rawText);

  // 1️⃣ genera audio con ElevenLabs
  const audioUrl = await generateSummaryAudio(summary, sessionID);

  // payload verso il frontend
  payload.summary = summary;
  payload.audioUrl = audioUrl || null;

  // 2️⃣ salva nel DB, includendo audioUrl
  await pool.request()
    .input("SessionID", sql.Int, sessionID)
    .input("Summary", sql.NVarChar(sql.MAX), summary)
    .input("AiLevel", sql.VarChar(20), "summary")
    .input("AudioUrl", sql.NVarChar(300), audioUrl || null)
    .query(`
      INSERT INTO study_summaries (sessionID, summary, aiLevel, audioUrl)
      VALUES (@SessionID, @Summary, @AiLevel, @AudioUrl)
    `);
}


    if (mode === "scientific") {
      const solution = await aiService.solveScientific(rawText);

      payload.solutionSteps = solution.steps;
      payload.finalAnswer = solution.finalAnswer;

      await pool.request()
        .input("SessionID", sql.Int, sessionID)
        .input("DetectedType", sql.VarChar(20), "scientific")
        .input("ProblemText", sql.NVarChar(sql.MAX), rawText)
        .input("SolutionSteps", sql.NVarChar(sql.MAX), solution.steps)
        .input("FinalAnswer", sql.NVarChar(255), solution.finalAnswer)
        .query(`
          INSERT INTO study_problems
          (sessionID, detectedType, problemText, solutionSteps, finalAnswer)
          VALUES (@SessionID, @DetectedType, @ProblemText, @SolutionSteps, @FinalAnswer)
        `);
    }

    if (mode === "oral") {
      const oralSummary = await aiService.generateSummary(rawText);
      payload.summary = oralSummary;

      await pool.request()
        .input("SessionID", sql.Int, sessionID)
        .input("Summary", sql.NVarChar(sql.MAX), oralSummary)
        .input("AiLevel", sql.VarChar(20), "oral")
        .query(`
          INSERT INTO study_summaries (sessionID, summary, aiLevel)
          VALUES (@SessionID, @Summary, @AiLevel)
        `);
    }

    console.log("✅ PROCESSAMENTO COMPLETO");
    payload.text = rawText; // aggiungiamo il testo OCR base
return res.json(payload);


  } catch (err) {
    console.error("❌ processFromImages ERROR:", err);
    res.status(500).json({ error: "Errore elaborazione immagini" });

  } finally {
    // cleanup file temporanei
    (req.files || []).forEach((f) => {
      try { fs.unlinkSync(f.path); } catch {}
    });
  }
};

/* ===========================================================
   🎙 VALUTAZIONE ORALE (con transcript + score + salvataggio completo)
   =========================================================== */
exports.evaluateOral = async (req, res) => {
  try {
    console.log("🎤 EVALUATE ORAL DEBUG");
    console.log("req.body:", req.body);
    console.log("req.file:", req.file);

    const userID = req.user.userId;
    const audioFile = req.file;
    const sessionID = req.body.sessionID || null;

    if (!audioFile) {
      return res.status(400).json({ error: "File audio mancante" });
    }

    const pool = await db.getConnection();

    /* 1️⃣ Recuperiamo il testo ideale */
    let reference = req.body.summary || null;

    if (!reference && sessionID) {
      const q = await pool.request()
        .input("SessionID", sql.Int, sessionID)
        .query(`
          SELECT TOP 1 summary 
          FROM study_summaries
          WHERE sessionID = @SessionID
          ORDER BY summaryID DESC
        `);

      reference = q.recordset[0]?.summary || null;
    }

    /* 2️⃣ Trascrizione audio → testo studente */
    const userText = await aiService.transcribeAudio(audioFile.path);
    console.log("📌 TESTO TRASCRITTO:", userText);

    /* 3️⃣ Valutazione AI: feedback + score */
    const evalResult = await aiService.scoreOralAnswer(
      reference || "",
      userText || ""
    );

    const feedback = evalResult.feedback || "";
    const score = evalResult.score ?? null;

    /* 4️⃣ SALVATAGGIO COMPLETO */
    await pool.request()
      .input("SessionID", sql.Int, sessionID)
      .input("UserID", sql.Int, userID)
      .input("AiSummary", sql.NVarChar(sql.MAX), reference || "")
      .input("UserAudioURL", sql.NVarChar(500), audioFile.path)
      .input("AiFeedback", sql.NVarChar(sql.MAX), feedback)
      .input("Score", sql.Int, score)
      .input("Transcript", sql.NVarChar(sql.MAX), userText)
      .query(`
        INSERT INTO study_oral_evaluations
          (sessionID, userID, aiSummary, userAudioURL, aiFeedback, score, transcript, createdAt)
        VALUES
          (@SessionID, @UserID, @AiSummary, @UserAudioURL, @AiFeedback, @Score, @Transcript, GETDATE())
      `);

    /* 5️⃣ RISPOSTA AL CLIENT */
    return res.json({
      transcript: userText,
      feedback,
      score
    });

  } catch (err) {
    console.error("❌ evaluateOral:", err);
    return res.status(500).json({ error: "Errore valutazione orale" });

  } finally {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  }
};



/* ===========================================================
   📚 RECUPERA LISTA SESSIONI (cronologia)
=========================================================== */
exports.getStudySessions = async (req, res) => {
  try {
    const userID = req.user.userId;
    const pool = await db.getConnection();

    const q = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
  s.sessionID,
  s.subject,
  s.type,
  s.createdAt,
  SUMM.summary,
  SUMM.audioUrl,
  oral.score AS oralScore
FROM study_sessions s
LEFT JOIN study_summaries SUMM 
  ON SUMM.sessionID = s.sessionID
LEFT JOIN study_oral_evaluations oral
  ON oral.sessionID = s.sessionID
WHERE s.userID = @UserID
ORDER BY s.createdAt DESC

      `);

    res.json(q.recordset);
  } catch (err) {
    console.error("❌ getStudySessions:", err);
    res.status(500).json({ error: "Errore caricamento sessioni" });
  }
};

/* ===========================================================
   📘 RECUPERA DETTAGLI DI UNA SESSIONE (summary + audio)
=========================================================== */
exports.getStudySession = async (req, res) => {
  try {
    const sessionID = req.params.sessionID;
    const userID = req.user.userId;

    const pool = await db.getConnection();

    const q = await pool.request()
      .input("SessionID", sql.Int, sessionID)
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
          s.sessionID,
          s.subject,
          s.type,
          s.createdAt,
          SUMM.summary,
          SUMM.audioUrl
        FROM study_sessions s
        LEFT JOIN study_summaries SUMM 
          ON SUMM.sessionID = s.sessionID
        WHERE s.sessionID = @SessionID
          AND s.userID = @UserID
      `);

    if (!q.recordset.length) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    res.json(q.recordset[0]);
  } catch (err) {
    console.error("❌ getStudySession:", err);
    res.status(500).json({ error: "Errore caricamento sessione" });
  }
};

/* ===========================================================
   ⭐ SALVA RATING
=========================================================== */
exports.setRating = async (req, res) => {
  try {
    const sessionID = req.params.sessionID;
    const { rating } = req.body;
    const userID = req.user.userId;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating non valido" });
    }

    const pool = await db.getConnection();

    await pool.request()
      .input("SessionID", sql.Int, sessionID)
      .input("UserID", sql.Int, userID)
      .input("Rating", sql.Int, rating)
      .query(`
        UPDATE study_sessions
        SET rating = @Rating
        WHERE sessionID = @SessionID AND userID = @UserID
      `);

    res.json({ success: true });
  } catch (err) {
    console.log("❌ setRating:", err);
    res.status(500).json({ error: "Errore salvataggio rating" });
  }
};

exports.getGlobalStats = async (req, res) => {
  try {
    const userID = req.user.userId;
    const pool = await db.getConnection();

    // ⭐ Rating medio
    const q1 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT AVG(CAST(rating AS FLOAT)) AS avgRating
        FROM study_sessions
        WHERE userID = @UserID AND rating IS NOT NULL
      `);

    // ⭐ Sessioni per giorno
    const q2 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
          CONVERT(date, createdAt) AS day,
          COUNT(*) AS total
        FROM study_sessions
        WHERE userID = @UserID
        GROUP BY CONVERT(date, createdAt)
        ORDER BY day ASC
      `);

    // ⭐ Modalità più usate
    const q3 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT type, COUNT(*) AS total
        FROM study_sessions
        WHERE userID = @UserID
        GROUP BY type
      `);

    return res.json({
      avgRating: q1.recordset[0].avgRating || 0,
      sessionsPerDay: q2.recordset,
      modes: q3.recordset,
    });

  } catch (err) {
    console.log("❌ getGlobalStats:", err);
    res.status(500).json({ error: "Errore calcolo statistiche" });
  }
};

/* ===========================================================
   📊 STATISTICHE GLOBALI UTENTE
   =========================================================== */
exports.getStudyStats = async (req, res) => {
  try {
    const userID = req.user.userId;
    const pool = await db.getConnection();

    /* --------------------------------------------------------------
       1️⃣ Sessioni totali + media voti
    -------------------------------------------------------------- */
    const q1 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
          COUNT(*) AS totalSessions,
          AVG(CAST(rating AS FLOAT)) AS averageRating
        FROM study_sessions
        WHERE userID = @UserID
      `);

    const totalSessions = q1.recordset[0].totalSessions || 0;
    const averageRating = q1.recordset[0].averageRating || 0;

    /* --------------------------------------------------------------
       2️⃣ Modalità usate (summary / scientific / oral)
    -------------------------------------------------------------- */
    const q2 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
          type,
          COUNT(*) AS count
        FROM study_sessions
        WHERE userID = @UserID
        GROUP BY type
      `);

    let modes = { summary: 0, scientific: 0, oral: 0 };
    q2.recordset.forEach((row) => {
      modes[row.type] = row.count;
    });

    /* --------------------------------------------------------------
       3️⃣ Score progress (per grafico)
          → usa le stelline delle sessioni
    -------------------------------------------------------------- */
    const q3 = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT TOP 20 rating
        FROM study_sessions
        WHERE userID = @UserID
          AND rating IS NOT NULL
        ORDER BY createdAt ASC
      `);

    const scoreProgress = q3.recordset.map((r) => r.rating);

    /* --------------------------------------------------------------
       4️⃣ Tempo di studio (stimato)
          → ogni sessione ≈ 10 minuti
          (oppure aggiungiamo misurazione reale se vuoi)
    -------------------------------------------------------------- */
    const studyMinutes = totalSessions * 10;

    /* --------------------------------------------------------------
       📦 RISPOSTA COMPLETA
    -------------------------------------------------------------- */
    return res.json({
      totalSessions,
      averageRating,
      modes,
      scoreProgress,
      studyMinutes,
    });

  } catch (err) {
    console.error("❌ getStudyStats:", err);
    res.status(500).json({ error: "Errore caricamento statistiche" });
  }
};

/* ===========================================================
   📊 STATISTICHE PERSONALI (per grafico profilo)
   GET /api/study/stats
=========================================================== */
exports.getStudyStats = async (req, res) => {
  try {
    const userID = req.user.userId;
    const pool = await db.getConnection();

    // 1️⃣ Totali per utente
    const qTotals = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT
          COUNT(*) AS totalSessions,
          SUM(CASE WHEN type = 'summary'    THEN 1 ELSE 0 END) AS totalSummaries,
          SUM(CASE WHEN type = 'scientific' THEN 1 ELSE 0 END) AS totalScientific,
          SUM(CASE WHEN type = 'oral'       THEN 1 ELSE 0 END) AS totalOral
        FROM study_sessions
        WHERE userID = @UserID
      `);

    const totals = qTotals.recordset[0] || {
      totalSessions: 0,
      totalSummaries: 0,
      totalScientific: 0,
      totalOral: 0,
    };

    // 2️⃣ Statistiche orali (valutazioni)
    const qOral = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT
          COUNT(*) AS totalOralEvaluations,
          AVG(CAST(score AS FLOAT)) AS avgOralScore
        FROM study_oral_evaluations
        WHERE userID = @UserID
      `);

    const oralStats = qOral.recordset[0] || {
      totalOralEvaluations: 0,
      avgOralScore: null,
    };

    // 3️⃣ Serie temporale ultimi 7 giorni
    const qDays = await pool.request()
      .input("UserID", sql.Int, userID)
      .query(`
        SELECT 
          CONVERT(date, createdAt) AS d,
          COUNT(*) AS sessions,
          SUM(CASE WHEN type = 'oral' THEN 1 ELSE 0 END) AS oralSessions
        FROM study_sessions
        WHERE userID = @UserID
          AND createdAt >= DATEADD(DAY, -6, CONVERT(date, GETDATE()))
        GROUP BY CONVERT(date, createdAt)
        ORDER BY d
      `);

    const mapByDate = {};
    qDays.recordset.forEach((row) => {
      const key = row.d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      mapByDate[key] = {
        sessions: row.sessions,
        oral: row.oralSessions,
      };
    });

    // Costruisci array ultimi 7 giorni (oggi incluso)
    const byDay = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);

      const key = d.toISOString().slice(0, 10);
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");

      const stats = mapByDate[key] || { sessions: 0, oral: 0 };

      byDay.push({
        date: key,
        label: `${dd}/${mm}`,
        sessions: stats.sessions,
        oral: stats.oral,
      });
    }

    return res.json({
      totalSessions: totals.totalSessions || 0,
      totalSummaries: totals.totalSummaries || 0,
      totalScientific: totals.totalScientific || 0,
      totalOral: totals.totalOral || 0,
      totalOralEvaluations: oralStats.totalOralEvaluations || 0,
      avgOralScore: oralStats.avgOralScore,
      byDay,
    });
  } catch (err) {
    console.error("❌ getStudyStats:", err);
    res.status(500).json({ error: "Errore caricamento statistiche" });
  }
};


/* ===========================================================
   🌍 STATISTICHE GLOBALI (facoltative, per confronto)
   GET /api/study/stats/global
=========================================================== */
exports.getGlobalStats = async (req, res) => {
  try {
    const pool = await db.getConnection();

    const qSessions = await pool.request().query(`
      SELECT COUNT(*) AS totalSessions
      FROM study_sessions
    `);

    const qOral = await pool.request().query(`
      SELECT 
        COUNT(*) AS totalOralEvaluations,
        AVG(CAST(score AS FLOAT)) AS avgOralScore
      FROM study_oral_evaluations
    `);

    const s1 = qSessions.recordset[0] || { totalSessions: 0 };
    const s2 = qOral.recordset[0] || {
      totalOralEvaluations: 0,
      avgOralScore: null,
    };

    res.json({
      totalSessionsAll: s1.totalSessions || 0,
      totalOralEvaluationsAll: s2.totalOralEvaluations || 0,
      avgOralScoreAll: s2.avgOralScore,
    });
  } catch (err) {
    console.error("❌ getGlobalStats:", err);
    res.status(500).json({ error: "Errore statistiche globali" });
  }
};
