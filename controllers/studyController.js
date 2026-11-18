const fs = require("fs");
const db = require("../db");

const ocrService = require("../services/ocrService");
const aiService = require("../services/aiService");
const { checkLimit, incrementUsage } = require("../services/usageLimitService");
const { getSubscriptionStatus } = require("../services/subscriptionService");
const { getUsagePolicy } = require("../services/usagePolicy");

function detectSubjectFromText(text) {
  const t = String(text || "").toLowerCase();

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

exports.processFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

    const mode = (req.body.mode || "summary").toLowerCase();
    if (!["summary", "scientific", "oral"].includes(mode)) {
      return res.status(400).json({ error: "STUDY_MODE_INVALID" });
    }

    const subscription = await getSubscriptionStatus(userID);
    const policy = getUsagePolicy(subscription.isPro);

    const limitCheck = await checkLimit(userID, "study_sessions", policy.studyDaily);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "STUDY_DAILY_LIMIT",
        feature: "study_sessions",
        limit: policy.studyDaily,
        remaining: 0,
        isPro: subscription.isPro,
        reset: "domani",
      });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Nessuna immagine fornita" });
    }

    if (files.length > policy.studyMaxImages) {
      return res.status(400).json({
        error: "IMAGE_LIMIT_EXCEEDED",
        limit: policy.studyMaxImages,
      });
    }

    let rawText = "";
    for (const file of files) {
      try {
        const text = await ocrService.extractTextFromImages([file]);
        rawText += "\n" + (text || "");
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    rawText = rawText.trim();
    if (rawText.length < 15) {
      return res.status(400).json({ error: "Testo OCR non valido" });
    }

    const subject = detectSubjectFromText(rawText);

    const qSession = await db.query(
      `INSERT INTO study_sessions (userid, subject, type, rawtext, createdat)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING sessionid`,
      [userID, subject, mode, rawText]
    );

    const sessionID = qSession.rows[0].sessionid;
    const payload = {
      sessionID,
      limit: policy.studyDaily,
      isPro: subscription.isPro,
      ocrText: rawText,
    };

    if (mode === "summary") {
      payload.summary = await aiService.generateSummary(rawText);
      if (!payload.summary || payload.summary.startsWith("Errore")) {
        throw new Error("SUMMARY_GENERATION_FAILED");
      }
    }

    if (mode === "scientific") {
      const solution = await aiService.solveScientificGuided(rawText);
      if (!solution || !solution.finalAnswer) {
        return res.status(400).json({
          error: "SCIENTIFIC_NOT_SOLVABLE",
          message: "Impossibile risolvere il problema scientifico",
        });
      }

      payload.solutionSteps = solution.steps || [];
      payload.finalAnswer = solution.finalAnswer;
      payload.fallback = !!solution.fallback;
    }

   if (mode === "oral") {
  payload.summary = await aiService.generateOralSummary(rawText);
  if (!payload.summary || payload.summary.startsWith("Errore")) {
    throw new Error("ORAL_SUMMARY_GENERATION_FAILED");
  }
}

/* -------------------------------------------------
   SALVATAGGIO RIASSUNTO
------------------------------------------------- */
if (payload.summary) {
  await db.query(
    `INSERT INTO study_summaries
       (sessionid, summary)
     VALUES ($1, $2)`,
    [sessionID, payload.summary]
  );
}

await incrementUsage(userID, "study_sessions");
    payload.remaining = Math.max(0, Number(limitCheck.remaining || 0) - 1);

    return res.json(payload);
  } catch (err) {
    console.error("processFromImages:", err);
    return res.status(500).json({ error: "Errore elaborazione studio" });
  }
};

exports.evaluateOral = async (req, res) => {
  try {
    const userID = req.user?.userId;
    const audioFile = req.file;
    const sessionID = Number(req.body?.sessionID);

    if (!userID) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!audioFile) return res.status(400).json({ error: "File audio mancante" });
    if (!Number.isInteger(sessionID) || sessionID <= 0) {
      return res.status(400).json({ error: "SESSION_INVALID" });
    }

    const sessionQ = await db.query(
      `SELECT sessionid, rawtext
       FROM study_sessions
       WHERE sessionid = $1 AND userid = $2 AND type = 'oral'`,
      [sessionID, userID]
    );

    if (!sessionQ.rows.length) {
      return res.status(404).json({ error: "SESSION_NOT_FOUND" });
    }

    const subscription = await getSubscriptionStatus(userID);
    const policy = getUsagePolicy(subscription.isPro);
    const limitCheck = await checkLimit(userID, "oral_evaluations", policy.oralDaily);

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "oral_evaluations",
        limit: policy.oralDaily,
        remaining: 0,
        isPro: subscription.isPro,
        reset: "domani",
      });
    }

    const reference = sessionQ.rows[0].rawtext || "";
    const transcript = await aiService.transcribeAudio(audioFile.path);

    if (!transcript || transcript.trim().length < 3) {
      return res.status(400).json({
        error: "TRANSCRIPTION_EMPTY",
        message: "Non sono riuscito a trascrivere la registrazione.",
      });
    }

    const rubric = await aiService.scoreOralAnswer(reference, transcript);
    if (!rubric || typeof rubric.voto_finale !== "number") {
      throw new Error("ORAL_RUBRIC_INVALID");
    }

    await db.query(
      `INSERT INTO study_oral_evaluations
       (sessionid, userid, aisummary, useraudiourl, aifeedback, score, transcript, createdat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        sessionID,
        userID,
        reference,
        audioFile.path,
        rubric.commento_prof || "",
        rubric.voto_finale,
        transcript,
      ]
    );

    await incrementUsage(userID, "oral_evaluations");

    return res.json({
      rubric,
      transcript,
      isPro: subscription.isPro,
      limit: policy.oralDaily,
      remaining: Math.max(0, Number(limitCheck.remaining || 0) - 1),
    });
  } catch (err) {
    console.error("evaluateOral:", err);
    return res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    try { fs.unlinkSync(req.file?.path); } catch {}
  }
};

exports.getStudySessions = async (req, res) => {
  try {
    const userID = req.user.userId;

    const q = await db.query(
      `SELECT
         sessionid AS "sessionID",
         subject,
         type,
         createdat AS "createdAt",
         rating,
         NULL::text AS "audioUrl"
       FROM study_sessions
       WHERE userid = $1
       ORDER BY createdat DESC`,
      [userID]
    );

    return res.json(q.rows);
  } catch (err) {
    console.error("getStudySessions:", err);

    return res.status(500).json({
      error: "STUDY_SESSIONS_ERROR",
      message: err.message,
    });
  }
};


exports.getStudySession = async (req, res) => {
  try {
    const userID = req.user.userId;
    const { sessionID } = req.params;

    const q = await db.query(
      `SELECT
         s.sessionid AS "sessionID",
         s.subject,
         s.type,
         s.rawtext AS "rawText",
         s.createdat AS "createdAt",
         s.rating,
         ss.summary,
         ss.audiourl AS "audioUrl"
       FROM study_sessions s

       LEFT JOIN LATERAL (
         SELECT
           summary,
           audiourl
         FROM study_summaries
         WHERE sessionid = s.sessionid
         ORDER BY summaryid DESC
         LIMIT 1
       ) ss ON TRUE

       WHERE s.sessionid = $1
         AND s.userid = $2`,
      [sessionID, userID]
    );

    return res.json(q.rows[0] || null);
  } catch (err) {
    console.error("getStudySession:", err);

    return res.status(500).json({
      error: "STUDY_SESSION_ERROR",
      message: err.message,
    });
  }
};

exports.getOralStudyDetail = async (req, res) => {
  try {
    const userID = req.user.userId;
    const { sessionID } = req.params;

    const sessionQ = await db.query(
      `SELECT sessionid, rawtext
       FROM study_sessions
       WHERE sessionid = $1 AND userid = $2 AND type = 'oral'`,
      [sessionID, userID]
    );

    if (!sessionQ.rows.length) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    const evalQ = await db.query(
      `SELECT id, score, aifeedback AS comment, createdat
       FROM study_oral_evaluations
       WHERE sessionid = $1 AND userid = $2
       ORDER BY createdat DESC`,
      [sessionID, userID]
    );

    const subscription = await getSubscriptionStatus(userID);
    const policy = getUsagePolicy(subscription.isPro);
    const limitCheck = await checkLimit(userID, "oral_evaluations", policy.oralDaily);

    return res.json({
      sessionID,
      referenceText: sessionQ.rows[0].rawtext,
      evaluations: evalQ.rows,
      dailyLimitReached: !limitCheck.allowed,
      remaining: limitCheck.remaining,
      limit: policy.oralDaily,
      isPro: subscription.isPro,
    });
  } catch (err) {
    console.error("getOralStudyDetail:", err);
    return res.status(500).json({ error: "ORAL_DETAIL_ERROR" });
  }
};

exports.setRating = async (req, res) => {
  try {
    const userID = req.user.userId;
    const { sessionID } = req.params;
    const rating = Number(req.body?.rating);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "RATING_INVALID" });
    }

    await db.query(
      `UPDATE study_sessions
       SET rating = $1
       WHERE sessionid = $2 AND userid = $3`,
      [rating, sessionID, userID]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("setRating:", err);
    return res.status(500).json({ error: "RATING_ERROR" });
  }
};

exports.getStudyStats = async (req, res) => {
  try {
    const userID = req.user.userId;

    const totalsQ = await db.query(
      `SELECT
         COUNT(*)::int AS total_sessions,
         COUNT(*) FILTER (WHERE type = 'summary')::int AS total_summaries,
         COUNT(*) FILTER (WHERE type = 'scientific')::int AS total_scientific,
         COUNT(*) FILTER (WHERE type = 'oral')::int AS total_oral,
         AVG(rating)::float AS avg_rating
       FROM study_sessions
       WHERE userid = $1`,
      [userID]
    );

    const oralQ = await db.query(
      `SELECT COUNT(*)::int AS total_oral_evaluations,
              AVG(score)::float AS avg_oral_score
       FROM study_oral_evaluations
       WHERE userid = $1`,
      [userID]
    );

    const byDayQ = await db.query(
      `WITH days AS (
         SELECT generate_series(
           CURRENT_DATE - INTERVAL '6 days',
           CURRENT_DATE,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT TO_CHAR(days.day, 'DD/MM') AS label,
              COUNT(s.sessionid)::int AS sessions
       FROM days
       LEFT JOIN study_sessions s
         ON s.userid = $1 AND s.createdat::date = days.day
       GROUP BY days.day
       ORDER BY days.day`,
      [userID]
    );

    const totals = totalsQ.rows[0] || {};
    const oral = oralQ.rows[0] || {};

    return res.json({
      totalSessions: totals.total_sessions || 0,
      totalSummaries: totals.total_summaries || 0,
      totalScientific: totals.total_scientific || 0,
      totalOral: totals.total_oral || 0,
      totalOralEvaluations: oral.total_oral_evaluations || 0,
      avgOralScore: oral.avg_oral_score || 0,
      avgRating: totals.avg_rating || 0,
      byDay: byDayQ.rows,
    });
  } catch (err) {
    console.error("getStudyStats:", err);
    return res.status(500).json({ error: "STUDY_STATS_ERROR" });
  }
};

exports.getGlobalStats = async (_req, res) => {
  try {
    const q = await db.query(
      `SELECT COUNT(*)::int AS total_sessions FROM study_sessions`
    );
    return res.json(q.rows[0]);
  } catch (err) {
    console.error("getGlobalStats:", err);
    return res.status(500).json({ error: "GLOBAL_STATS_ERROR" });
  }
};
