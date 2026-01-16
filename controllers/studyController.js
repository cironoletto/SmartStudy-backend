const fs = require("fs");
const db = require("../db");

const ocrService = require("../services/ocrService");
const aiService = require("../services/aiService");
const { generateSummaryAudio } = require("../services/openaiTtsService");

// 🔽 NUOVI METODI (NON rompono nulla)
const {
  checkLimit,
  incrementUsage,
} = require("../services/usageLimitService");

const {
  canGenerateTTS,
  incrementTTS,
} = require("../services/ttsUsageService");

/* ===========================================================
   🔎 RILEVAMENTO MATERIA
=========================================================== */
function detectSubjectFromText(text) {
  const t = text.toLowerCase();

  if (["funzione", "derivata", "asintoto", "integrale"].some(k => t.includes(k)))
    return "Matematica";

  if (["poesia", "autore", "testo", "analisi del testo"].some(k => t.includes(k)))
    return "Italiano";

  if (["rivoluzione", "storia", "secolo", "guerra"].some(k => t.includes(k)))
    return "Storia";

  if (["chimica", "molecola", "reazione"].some(k => t.includes(k)))
    return "Scienze";

  return "Studio";
}

/* ===========================================================
   📸 OCR + STUDY
=========================================================== */
exports.processFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) {
      return res.status(401).json({ error: "Utente non autenticato" });
    }

    /* ---------------- MODE ---------------- */
    const mode = (req.body.mode || "summary").toLowerCase();

    /* ---------------- LIMITI ---------------- */
    const FREE_LIMITS = {
      summary: 1,
      scientific: 1,
      oral: 1,
    };

    const isPro = false; // 🔜 collegare a subscription
    const DAILY_LIMIT = isPro ? 10 : (FREE_LIMITS[mode] ?? 1);
    const featureKey = `study_${mode}`;

    // ✅ CHECK (non incrementa)
    const limitCheck = await checkLimit(userID, featureKey, DAILY_LIMIT);

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "STUDY_DAILY_LIMIT",
        feature: mode,
        remaining: limitCheck.remaining ?? 0,
        limit: DAILY_LIMIT,
        isPro,
        reset: "domani",
      });
    }

    /* ---------------- FILES ---------------- */
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Nessuna immagine fornita" });
    }

    if (files.length > 3) {
      return res.status(400).json({ error: "Puoi caricare massimo 3 immagini" });
    }

    /* ---------------- OCR ---------------- */
    let rawText = "";
    for (const file of files) {
      try {
        const text = await ocrService.extractTextFromImages([file]);
        rawText += "\n" + (text || "");
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    if (rawText.length < 15) {
      return res.status(400).json({ error: "Testo OCR non valido" });
    }

    const subject = detectSubjectFromText(rawText);

    /* ---------------- SESSION ---------------- */
    const qSession = await db.query(
      `INSERT INTO study_sessions (userid, subject, type, rawtext, createdat)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING sessionid`,
      [userID, subject, mode, rawText]
    );

    const sessionID = qSession.rows[0].sessionid;

    /* ---------------- AI ---------------- */
   const payload = {
  sessionID,
  remaining: limitCheck.remaining,
  limit: DAILY_LIMIT,
  isPro,
  ocrText: rawText, // 👁️ PREVIEW OCR
};


    if (mode === "summary") {
      payload.summary = await aiService.generateSummary(rawText);
    }

    if (mode === "scientific") {
  try {
    const solution = await aiService.solveScientificGuided(rawText);

    if (!solution || !solution.finalAnswer) {
      return res.status(400).json({
        error: "SCIENTIFIC_NOT_SOLVABLE",
        message: "Impossibile risolvere il problema scientifico",
      });
    }

    payload.solutionSteps = solution.steps || [];
    payload.finalAnswer = solution.finalAnswer;
  } catch (e) {
    console.error("❌ solveScientificGuided:", e);
    return res.status(400).json({
      error: "SCIENTIFIC_FAILED",
      message: "Errore durante la risoluzione scientifica",
    });
  }
}


    if (mode === "oral") {
      payload.summary = await aiService.generateSummary(rawText);
    }

    // ✅ incrementa SOLO se tutto è andato a buon fine
    await incrementUsage(userID, featureKey);

    return res.json(payload);

  } catch (err) {
    console.error("❌ processFromImages:", err);
    return res.status(500).json({ error: "Errore elaborazione studio" });
  }
};

/* ===========================================================
   🎙 VALUTAZIONE ORALE
=========================================================== */
exports.evaluateOral = async (req, res) => {
  try {
    const userID = req.user.userId;
    const audioFile = req.file;
    const sessionID = req.body.sessionID;

    if (!audioFile) {
      return res.status(400).json({ error: "File audio mancante" });
    }

    const limitCheck = await checkLimit(userID, "oral_evaluations", 1);

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "oral_evaluations",
        reset: "domani",
      });
    }

    const q = await db.query(
      `SELECT summary FROM study_summaries
       WHERE sessionid=$1
       ORDER BY summaryid DESC LIMIT 1`,
      [sessionID]
    );

    const reference = q.rows[0]?.summary || "";
    const transcript = await aiService.transcribeAudio(audioFile.path);
    const rubric = await aiService.scoreOralAnswer(reference, transcript);

    await db.query(
      `INSERT INTO study_oral_evaluations
       (sessionid, userid, aisummary, useraudiourl, aifeedback, score, transcript, createdat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        sessionID,
        userID,
        reference,
        audioFile.path,
        rubric.commento_prof,
        rubric.voto_finale,
        transcript,
      ]
    );

    await incrementUsage(userID, "oral_evaluations");

    res.json({ rubric, transcript });

  } catch (err) {
    console.error("❌ evaluateOral:", err);
    res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    try { fs.unlinkSync(req.file?.path); } catch {}
  }
};

/* ===========================================================
   📚 CRONOLOGIA SESSIONI
=========================================================== */
exports.getStudySessions = async (req, res) => {
  const userID = req.user.userId;

  const q = await db.query(
    `SELECT sessionid AS "sessionID",
            subject,
            type,
            createdat AS "createdAt",
            rating,
            audio_url AS "audioUrl"
     FROM study_sessions
     WHERE userid = $1
     ORDER BY createdat DESC`,
    [userID]
  );

  res.json(q.rows);
};

exports.getStudySession = async (req, res) => {
  const userID = req.user.userId;
  const { sessionID } = req.params;

  const q = await db.query(
    `SELECT *
     FROM study_sessions
     WHERE sessionid = $1 AND userid = $2`,
    [sessionID, userID]
  );

  res.json(q.rows[0] || null);
};

exports.getOralStudyDetail = async (req, res) => {
  const userID = req.user.userId;
  const { sessionID } = req.params;

  // 🔎 sessione
  const sessionQ = await db.query(
    `SELECT sessionid, rawtext
     FROM study_sessions
     WHERE sessionid = $1 AND userid = $2 AND type = 'oral'`,
    [sessionID, userID]
  );

  if (!sessionQ.rows.length) {
    return res.status(404).json({ error: "Sessione non trovata" });
  }

  // 📊 valutazioni
  const evalQ = await db.query(
    `SELECT 
       id,
       score,
       aifeedback AS comment,
       createdat
     FROM study_oral_evaluations
     WHERE sessionid = $1
     ORDER BY createdat DESC`,
    [sessionID]
  );

  // 🔐 LIMITE GIORNALIERO (COME STUDY)
  const DAILY_LIMIT = 1; // FREE
  const isPro = false;   // 🔜 collegare subscription

  const limitCheck = await checkLimit(
    userID,
    "oral_evaluations",
    DAILY_LIMIT
  );

  res.json({
    sessionID,
    summary: sessionQ.rows[0].rawtext,
    evaluations: evalQ.rows,

    // ➕ NUOVI CAMPI (frontend-ready)
    dailyLimitReached: !limitCheck.allowed,
    remaining: limitCheck.remaining,
    limit: DAILY_LIMIT,
    isPro,
  });
};

/* ===========================================================
   ⭐ RATING
=========================================================== */
exports.setRating = async (req, res) => {
  const userID = req.user.userId;
  const { sessionID } = req.params;
  const { rating } = req.body;

  await db.query(
    `UPDATE study_sessions
     SET rating = $1
     WHERE sessionid = $2 AND userid = $3`,
    [rating, sessionID, userID]
  );

  res.json({ ok: true });
};

/* ===========================================================
   📊 STATISTICHE
=========================================================== */
exports.getStudyStats = async (req, res) => {
  const userID = req.user.userId;

  const q = await db.query(
    `SELECT COUNT(*)::int AS total,
            AVG(rating)::float AS avg_rating
     FROM study_sessions
     WHERE userid = $1`,
    [userID]
  );

  res.json(q.rows[0]);
};

exports.getGlobalStats = async (_req, res) => {
  const q = await db.query(
    `SELECT COUNT(*)::int AS total_sessions
     FROM study_sessions`
  );

  res.json(q.rows[0]);
};
