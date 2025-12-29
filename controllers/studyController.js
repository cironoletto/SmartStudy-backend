const fs = require("fs");
const db = require("../db");

const ocrService = require("../services/ocrService");
const aiService = require("../services/aiService");
const { generateSummaryAudio } = require("../services/openaiTtsService");
const { checkAndIncrement } = require("../services/usageLimitService");

const {
  canGenerateTTS,
  incrementTTS,
} = require("../services/ttsUsageService");

/* ===========================================================
   🔎 RILEVAMENTO MATERIA
=========================================================== */
function detectSubjectFromText(text) {
  const t = text.toLowerCase();

  if (["funzione","derivata","asintoto","integrale"].some(k => t.includes(k)))
    return "Matematica";

  if (["poesia","autore","testo","analisi del testo"].some(k => t.includes(k)))
    return "Italiano";

  if (["rivoluzione","storia","secolo","guerra"].some(k => t.includes(k)))
    return "Storia";

  if (["chimica","molecola","reazione"].some(k => t.includes(k)))
    return "Scienze";

  return "Studio";
}

/* ===========================================================
   📸 OCR + STUDY
=========================================================== */
exports.processFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

    /* 🔒 LIMITE STUDY FREE: 2 SESSIONI / GIORNO */
const studyLimit = await checkAndIncrement(
  userID,
  "study_sessions",
  2
);

if (!studyLimit.allowed) {
  return res.status(403).json({
    error: "STUDY_DAILY_LIMIT",
    feature: "study",
    reset: "domani"
  });
}

    const mode = (req.body.mode || "summary").toLowerCase();
    const files = req.files || [];

    if (!files.length)
      return res.status(400).json({ error: "Nessuna immagine fornita" });

    if (files.length > 3)
      return res.status(400).json({ error: "Puoi caricare massimo 3 immagini" });

    /* OCR SEQUENZIALE */
    let rawText = "";
    for (const file of files) {
      try {
        const text = await ocrService.extractTextFromImages([file]);
        rawText += "\n" + (text || "");
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    if (!rawText || rawText.length < 15)
      return res.status(400).json({ error: "Testo OCR troppo breve o non leggibile" });

    const subject = detectSubjectFromText(rawText);

    /* SALVA SESSIONE */
    const qSession = await db.query(
      `INSERT INTO study_sessions (userid, subject, type, rawtext, createdat)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING sessionid`,
      [userID, subject, mode, rawText]
    );

    const sessionID = qSession.rows[0].sessionid;
    const payload = { sessionID };

    /* ===================== SUMMARY ===================== */
    if (mode === "summary") {
      const summary = await aiService.generateSummary(rawText);
      let audioUrl = null;

      /* 🔒 BLOCCO TTS FREE */
      const ttsCheck = await checkAndIncrement(userID, "tts_audio", 0);
      if (ttsCheck.allowed) {
        audioUrl = await generateSummaryAudio(summary, sessionID);
        if (audioUrl) await incrementTTS(userID);
      }

      await db.query(
        `INSERT INTO study_summaries (sessionid, summary, ailevel, audiourl)
         VALUES ($1,$2,'summary',$3)`,
        [sessionID, summary, audioUrl]
      );

      payload.summary = summary;
      payload.audioUrl = audioUrl;
    }

    /* ===================== SCIENTIFIC ===================== */
    if (mode === "scientific") {
      const level = req.body.level || "guided";
      let solution;

      try {
        solution = level === "theory"
          ? await aiService.explainScientificTheory(rawText)
          : await aiService.solveScientificGuided(rawText);
      } catch {
        solution = { text: "Spiegazione teorica standard." };
      }

      await db.query(
        `INSERT INTO study_problems
         (sessionid, detectedtype, problemtext, solutionsteps, finalanswer)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          sessionID,
          level,
          rawText,
          solution.steps || [],
          solution.finalAnswer || solution.text
        ]
      );

      payload.level = level;
      payload.solutionSteps = solution.steps || [];
      payload.finalAnswer = solution.finalAnswer || solution.text;
    }

    /* ===================== ORAL ===================== */
    if (mode === "oral") {
      const summary = await aiService.generateSummary(rawText);

      await db.query(
        `INSERT INTO study_summaries (sessionid, summary, ailevel)
         VALUES ($1,$2,'oral')`,
        [sessionID, summary]
      );

      payload.summary = summary;
    }

    res.json(payload);

  } catch (err) {
    console.error("❌ processFromImages:", err);
    res.status(500).json({ error: "Errore elaborazione studio" });
  }
};

/* ===========================================================
   🎙 VALUTAZIONE ORALE (CON LIMITE)
=========================================================== */
exports.evaluateOral = async (req, res) => {
  try {
    const userID = req.user.userId;
    const audioFile = req.file;
    const sessionID = req.body.sessionID;

    if (!audioFile)
      return res.status(400).json({ error: "File audio mancante" });

    /* 🔒 LIMITE FREE: 1 AL GIORNO */
    const limitCheck = await checkAndIncrement(
      userID,
      "oral_evaluations",
      1
    );

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "oral_evaluations",
        reset: "domani"
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
        transcript
      ]
    );

    res.json({ rubric, transcript });

  } catch (err) {
    console.error("❌ evaluateOral:", err);
    res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    try { fs.unlinkSync(req.file?.path); } catch {}
  }
};

/* ===========================================================
   📚 SESSIONI / STATS / RATING (INVARIATI)
=========================================================== */

exports.getStudySessions = async (req, res) => {
  const q = await db.query(
    `SELECT s.sessionid AS "sessionID", s.subject, s.type, s.createdat AS "createdAt",
            s.rating, sm.summary, sm.audiourl AS "audioUrl"
     FROM study_sessions s
     LEFT JOIN LATERAL (
       SELECT summary, audiourl FROM study_summaries
       WHERE sessionid=s.sessionid
       ORDER BY summaryid DESC LIMIT 1
     ) sm ON true
     WHERE s.userid=$1
     ORDER BY s.createdat DESC`,
    [req.user.userId]
  );
  res.json(q.rows);
};

exports.getStudySession = async (req, res) => {
  const q = await db.query(
    `SELECT s.sessionid AS "sessionID", s.subject, s.type, s.createdat AS "createdAt",
            s.rating, sm.summary, sm.audiourl AS "audioUrl",
            sp.solutionsteps AS "solutionSteps", sp.finalanswer AS "finalAnswer"
     FROM study_sessions s
     LEFT JOIN LATERAL (
       SELECT summary, audiourl FROM study_summaries
       WHERE sessionid=s.sessionid
       ORDER BY summaryid DESC LIMIT 1
     ) sm ON true
     LEFT JOIN LATERAL (
       SELECT solutionsteps, finalanswer FROM study_problems
       WHERE sessionid=s.sessionid
       ORDER BY problemid DESC LIMIT 1
     ) sp ON true
     WHERE s.sessionid=$1 AND s.userid=$2`,
    [req.params.sessionID, req.user.userId]
  );

  if (!q.rows.length)
    return res.status(404).json({ error: "Sessione non trovata" });

  res.json(q.rows[0]);
};

exports.setRating = async (req, res) => {
  await db.query(
    `UPDATE study_sessions SET rating=$1
     WHERE sessionid=$2 AND userid=$3`,
    [req.body.rating, req.params.sessionID, req.user.userId]
  );
  res.json({ success: true });
};

exports.getStudyStats = async (req, res) => {
  const q = await db.query(
    `SELECT COUNT(*) total, AVG(rating) avg
     FROM study_sessions WHERE userid=$1`,
    [req.user.userId]
  );
  res.json(q.rows[0]);
};

exports.getGlobalStats = async (_req, res) => {
  const q = await db.query(`SELECT COUNT(*) total FROM study_sessions`);
  res.json(q.rows[0]);
};
