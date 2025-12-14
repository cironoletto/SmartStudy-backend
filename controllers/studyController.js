// controllers/studyController.js
const fs = require("fs");
const db = require("../db");

const ocrService = require("../services/ocrService");
const aiService = require("../services/aiService");
const { generateSummaryAudio } = require("../services/openaiTtsService");

const {
  canGenerateTTS,
  incrementTTS,
} = require("../services/ttsUsageService");

/* ===========================================================
   📸 PROCESS IMAGES → OCR → AI
=========================================================== */
exports.processFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

    const mode = (req.body.mode || "summary").toLowerCase();
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: "Nessuna immagine fornita" });
    }

    console.log("✅ FILES RICEVUTI:", (req.files || []).map(f => ({
  fieldname: f.fieldname,
  originalname: f.originalname,
  mimetype: f.mimetype,
  size: f.size,
  path: f.path
})));


    // 1️⃣ OCR
   const rawText = await ocrService.extractTextFromImages(files);

   console.log("✅ OCR rawText typeof:", typeof rawText);
console.log("✅ OCR rawText length:", rawText?.length);
console.log("✅ OCR rawText preview:", rawText?.slice?.(0, 120));

if (!rawText) {
  return res.status(400).json({ error: "OCR fallito" });
}

const cleanedText = rawText
  .replace(/\s+/g, " ")
  .replace(/[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ.,;:!?()\n ]/g, "")
  .trim();

if (cleanedText.length < 15) {
  return res.status(400).json({
    error: "Testo troppo breve o poco leggibile. Prova una foto più nitida.",
    debugLength: cleanedText.length,
  });
}


    // 2️⃣ Salva sessione
    const qSession = await db.query(
      `INSERT INTO study_sessions (userid, subject, type, rawtext, createdat)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING sessionid`,
      [userID, req.body.subject || null, mode, rawText]
    );

    const sessionID = qSession.rows[0].sessionid;
    const payload = { sessionID, text: rawText };

    /* ======================================================
       MODE: SUMMARY
    ====================================================== */
 if (mode === "summary") {
  const summary = await aiService.generateSummary(rawText);

  let audioUrl = null;

  // 🔒 FAIR USE TTS (con limite configurabile)
  if (await canGenerateTTS(userID)) {
    audioUrl = await generateSummaryAudio(summary, sessionID);

    if (audioUrl) {
      await incrementTTS(userID);
    }
  } else {
    console.log("⚠️ Limite TTS giornaliero raggiunto per user", userID);
  }

  payload.summary = summary;
  payload.audioUrl = audioUrl;

  await db.query(
    `INSERT INTO study_summaries (sessionid, summary, ailevel, audiourl)
     VALUES ($1, $2, 'summary', $3)`,
    [sessionID, summary, audioUrl]
  );
}




    /* ======================================================
       MODE: SCIENTIFIC
    ====================================================== */
    if (mode === "scientific") {
      const solution = await aiService.solveScientific(rawText);

      payload.solutionSteps = solution.steps;
      payload.finalAnswer = solution.finalAnswer;

      await db.query(
        `INSERT INTO study_problems
           (sessionid, detectedtype, problemtext, solutionsteps, finalanswer)
         VALUES ($1, 'scientific', $2, $3, $4)`,
        [sessionID, rawText, solution.steps, solution.finalAnswer]
      );
    }

    /* ======================================================
       MODE: ORAL
    ====================================================== */
    if (mode === "oral") {
      const oralSummary = await aiService.generateSummary(rawText);

      payload.summary = oralSummary;

      await db.query(
        `INSERT INTO study_summaries (sessionid, summary, ailevel)
         VALUES ($1, $2, 'oral')`,
        [sessionID, oralSummary]
      );
    }

    return res.json(payload);

  } catch (err) {
    console.error("❌ processFromImages Error:", err);
    res.status(500).json({ error: "Errore elaborazione immagini" });

  } finally {
    (req.files || []).forEach((f) => {
      try { fs.unlinkSync(f.path); } catch {}
    });
  }
};


/* ===========================================================
   🎙 VALUTAZIONE ORALE
=========================================================== */
exports.evaluateOral = async (req, res) => {
  try {
    const userID = req.user.userId;
    const audioFile = req.file;
    const sessionID = req.body.sessionID || null;

    if (!audioFile) {
      return res.status(400).json({ error: "File audio mancante" });
    }

    // 1️⃣ Recupero summary di riferimento
    let reference = req.body.summary || null;

    if (!reference && sessionID) {
      const q = await db.query(
        `SELECT summary
         FROM study_summaries
         WHERE sessionid = $1
         ORDER BY summaryid DESC
         LIMIT 1`,
        [sessionID]
      );

      reference = q.rows[0]?.summary || null;
    }

    // 2️⃣ Trascrizione audio
    const userText = await aiService.transcribeAudio(audioFile.path);

    // 3️⃣ Valutazione
    const evalResult = await aiService.scoreOralAnswer(reference || "", userText || "");
    const feedback = evalResult.feedback || "";
    const score = evalResult.score ?? null;

    // 4️⃣ Salvataggio DB
    await db.query(
      `INSERT INTO study_oral_evaluations
         (sessionid, userid, aisummary, useraudiourl, aifeedback, score, transcript, createdat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [sessionID, userID, reference || "", audioFile.path, feedback, score, userText]
    );

    res.json({ transcript: userText, feedback, score });

  } catch (err) {
    console.error("❌ evaluateOral:", err);
    res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  }
};


/* ===========================================================
   📚 LISTA SESSIONI
=========================================================== */
exports.getStudySessions = async (req, res) => {
  try {
    const userID = req.user.userId;

   const q = await db.query(
  `SELECT 
     s.sessionid     AS "sessionID",
     s.subject       AS "subject",
     s.type          AS "type",
     s.createdat     AS "createdAt",
     s.rating        AS "rating",
     sm.summary      AS "summary",
     sm.audiourl     AS "audioUrl",
     oral.score      AS "oralScore"
   FROM study_sessions s
   LEFT JOIN study_summaries sm ON sm.sessionid = s.sessionid
   LEFT JOIN study_oral_evaluations oral ON oral.sessionid = s.sessionid
   WHERE s.userid = $1
   ORDER BY s.createdat DESC`,
  [userID]
);

    res.json(q.rows);

  } catch (err) {
    console.error("❌ getStudySessions:", err);
    res.status(500).json({ error: "Errore caricamento sessioni" });
  }
};


/* ===========================================================
   📘 DETTAGLIO SESSIONE
=========================================================== */
exports.getStudySession = async (req, res) => {
  try {
    const sessionID = req.params.sessionID;
    const userID = req.user.userId;

    const q = await db.query(
  `SELECT 
     s.sessionid AS "sessionID",
     s.subject   AS "subject",
     s.type      AS "type",
     s.createdat AS "createdAt",
     sm.summary  AS "summary",
     sm.audiourl AS "audioUrl"
   FROM study_sessions s
   LEFT JOIN study_summaries sm ON sm.sessionid = s.sessionid
   WHERE s.sessionid = $1 AND s.userid = $2`,
  [sessionID, userID]
);


    if (!q.rows.length) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    res.json(q.rows[0]);

  } catch (err) {
    console.error("❌ getStudySession:", err);
    res.status(500).json({ error: "Errore caricamento sessione" });
  }
};


/* ===========================================================
   ⭐ SET RATING
=========================================================== */
exports.setRating = async (req, res) => {
  try {
    const sessionID = req.params.sessionID;
    const userID = req.user.userId;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating non valido" });
    }

    await db.query(
      `UPDATE study_sessions
       SET rating = $1
       WHERE sessionid = $2 AND userid = $3`,
      [rating, sessionID, userID]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("❌ setRating:", err);
    res.status(500).json({ error: "Errore salvataggio rating" });
  }
};


/* ===========================================================
   📊 STATISTICHE PRINCIPALI
=========================================================== */
exports.getStudyStats = async (req, res) => {
  try {
    const userID = req.user.userId;

    const q1 = await db.query(
      `SELECT 
         COUNT(*) AS totalsessions,
         AVG(rating) AS averagerating
       FROM study_sessions
       WHERE userid = $1`,
      [userID]
    );

    const q2 = await db.query(
      `SELECT type, COUNT(*) AS count
       FROM study_sessions
       WHERE userid = $1
       GROUP BY type`,
      [userID]
    );

    let modes = { summary: 0, scientific: 0, oral: 0 };
    q2.rows.forEach((row) => {
      modes[row.type] = row.count;
    });

    const q3 = await db.query(
      `SELECT rating 
       FROM study_sessions
       WHERE userid = $1 AND rating IS NOT NULL
       ORDER BY createdat ASC
       LIMIT 20`,
      [userID]
    );

    res.json({
      totalSessions: q1.rows[0].totalsessions,
      averageRating: q1.rows[0].averagerating,
      modes,
      scoreProgress: q3.rows.map((r) => r.rating),
    });

  } catch (err) {
    console.error("❌ getStudyStats:", err);
    res.status(500).json({ error: "Errore caricamento statistiche" });
  }
};


/* ===========================================================
   📊 STATISTICHE GLOBALI
=========================================================== */
exports.getGlobalStats = async (req, res) => {
  try {
    const q1 = await db.query(`SELECT COUNT(*) AS totalsessions FROM study_sessions`);

    const q2 = await db.query(
      `SELECT COUNT(*) AS totaloralevaluations, AVG(score) AS avgoralscore
       FROM study_oral_evaluations`
    );

    res.json({
      totalSessionsAll: q1.rows[0].totalsessions,
      totalOralEvaluationsAll: q2.rows[0].totaloralevaluations,
      avgOralScoreAll: q2.rows[0].avgoralscore,
    });

  } catch (err) {
    console.error("❌ getGlobalStats:", err);
    res.status(500).json({ error: "Errore statistiche globali" });
  }
};
