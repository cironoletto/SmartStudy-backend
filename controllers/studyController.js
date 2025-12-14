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
    console.log("🟦 STUDY mode =", mode);
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: "Nessuna immagine fornita" });
    }

    // 1️⃣ OCR
    const rawText = await ocrService.extractTextFromImages(files);
console.log("🟦 OCR OK, rawText length =", rawText?.length);

    if (!rawText || rawText.length < 15) {
      return res.status(400).json({
        error: "Testo OCR troppo breve o non leggibile",
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
    console.log("🟩 study_sessions INSERT OK sessionID =", sessionID);

    const payload = { sessionID };

    /* ===================== SUMMARY ===================== */
 if (mode === "summary") {
  console.log("🧠 ENTER SUMMARY BLOCK sessionID =", sessionID);

  const summary = await aiService.generateSummary(rawText);
  console.log("🧠 SUMMARY GENERATED length =", summary?.length);

  let audioUrl = null;

  console.log("🎛 canGenerateTTS: start");
  const okTts = await canGenerateTTS(userID);
  console.log("🎛 canGenerateTTS: result =", okTts);

  if (okTts) {
    console.log("🎧 generateSummaryAudio: start");
    audioUrl = await generateSummaryAudio(summary, sessionID);
    console.log("🎧 generateSummaryAudio: result =", audioUrl);

    if (audioUrl) {
      console.log("📈 incrementTTS: start");
      await incrementTTS(userID);
      console.log("📈 incrementTTS: done");
    }
  }

  console.log("📝 INSERT study_summaries: start");
  await db.query(
    `INSERT INTO study_summaries (sessionid, summary, ailevel, audiourl)
     VALUES ($1, $2, 'summary', $3)`,
    [sessionID, summary, audioUrl]
  );
  console.log("📝 INSERT study_summaries: done");

  payload.summary = summary;
  payload.audioUrl = audioUrl;
}


    /* ===================== SCIENTIFIC ===================== */
    if (mode === "scientific") {
      const solution = await aiService.solveScientific(rawText);

      await db.query(
        `INSERT INTO study_problems
         (sessionid, detectedtype, problemtext, solutionsteps, finalanswer)
         VALUES ($1, 'scientific', $2, $3, $4)`,
        [sessionID, rawText, solution.steps, solution.finalAnswer]
      );

      payload.solutionSteps = solution.steps;
      payload.finalAnswer = solution.finalAnswer;
    }

    /* ===================== ORAL ===================== */
    if (mode === "oral") {
      const summary = await aiService.generateSummary(rawText);

      await db.query(
        `INSERT INTO study_summaries (sessionid, summary, ailevel)
         VALUES ($1, $2, 'oral')`,
        [sessionID, summary]
      );

      payload.summary = summary;
    }
console.log("✅ RESPONDING payload keys =", Object.keys(payload));

    res.json(payload);

  } catch (err) {
  console.error("❌ processFromImages Error FULL:", err);
  console.error("❌ processFromImages Error STACK:", err.stack);

  res.status(500).json({
    error: "Errore elaborazione immagini",
    detail: err.message
  });
}
finally {
    (req.files || []).forEach(f => {
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
    const sessionID = req.body.sessionID;

    if (!audioFile) {
      return res.status(400).json({ error: "File audio mancante" });
    }

    const q = await db.query(
      `SELECT summary
       FROM study_summaries
       WHERE sessionid = $1
       ORDER BY summaryid DESC
       LIMIT 1`,
      [sessionID]
    );

    const reference = q.rows[0]?.summary || "";
    const userText = await aiService.transcribeAudio(audioFile.path);
    const evalResult = await aiService.scoreOralAnswer(reference, userText);

    await db.query(
      `INSERT INTO study_oral_evaluations
       (sessionid, userid, aisummary, useraudiourl, aifeedback, score, transcript, createdat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        sessionID,
        userID,
        reference,
        audioFile.path,
        evalResult.feedback,
        evalResult.score,
        userText,
      ]
    );

    res.json(evalResult);

  } catch (err) {
    console.error("❌ evaluateOral:", err);
    res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    try { fs.unlinkSync(req.file?.path); } catch {}
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
         s.sessionid AS "sessionID",
         s.subject,
         s.type,
         s.createdat AS "createdAt",
         s.rating,
         sm.summary,
         sm.audiourl AS "audioUrl"
       FROM study_sessions s
       LEFT JOIN LATERAL (
         SELECT summary, audiourl
         FROM study_summaries
         WHERE sessionid = s.sessionid
         ORDER BY summaryid DESC
         LIMIT 1
       ) sm ON true
       WHERE s.userid = $1
       ORDER BY s.createdat DESC`,
      [userID]
    );
console.log("🟨 getStudySessions rows =", q.rows.length);
console.log("🟨 first row preview =", q.rows[0]);

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
    const { sessionID } = req.params;
    const userID = req.user.userId;

    const q = await db.query(
      `SELECT
         s.sessionid AS "sessionID",
         s.subject,
         s.type,
         s.createdat AS "createdAt",
         s.rating,
         sm.summary,
         sm.audiourl AS "audioUrl",
         sp.solutionsteps AS "solutionSteps",
         sp.finalanswer AS "finalAnswer"
       FROM study_sessions s
       LEFT JOIN LATERAL (
         SELECT summary, audiourl
         FROM study_summaries
         WHERE sessionid = s.sessionid
         ORDER BY summaryid DESC
         LIMIT 1
       ) sm ON true
       LEFT JOIN LATERAL (
         SELECT solutionsteps, finalanswer
         FROM study_problems
         WHERE sessionid = s.sessionid
         ORDER BY problemid DESC
         LIMIT 1
       ) sp ON true
       WHERE s.sessionid = $1 AND s.userid = $2`,
      [sessionID, userID]
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }
console.log("🟨 getStudySession result =", q.rows[0]);

    res.json(q.rows[0]);
  } catch (err) {
    console.error("❌ getStudySession:", err);
    res.status(500).json({ error: "Errore caricamento sessione" });
  }
};

/* ===========================================================
   ⭐ RATING
=========================================================== */
exports.setRating = async (req, res) => {
  const { sessionID } = req.params;
  const { rating } = req.body;
  const userID = req.user.userId;

  await db.query(
    `UPDATE study_sessions
     SET rating = $1
     WHERE sessionid = $2 AND userid = $3`,
    [rating, sessionID, userID]
  );

  res.json({ success: true });
};

/* ===========================================================
   📊 STATISTICHE
=========================================================== */
exports.getStudyStats = async (req, res) => {
  const userID = req.user.userId;

  const q = await db.query(
    `SELECT COUNT(*) total, AVG(rating) avg
     FROM study_sessions WHERE userid = $1`,
    [userID]
  );

  res.json(q.rows[0]);
};

exports.getGlobalStats = async (_req, res) => {
  const q = await db.query(
    `SELECT COUNT(*) total FROM study_sessions`
  );
  res.json(q.rows[0]);
};
