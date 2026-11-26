const { subjectInstruction, supportedSubject } = require("../services/oralSubject");
const { plainSummary } = require("../services/summaryText");
const outputLanguage = require("../services/outputLanguage");
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

function removeFile(filePath) {
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(
      "Impossibile eliminare file temporaneo:",
      filePath,
      err?.message
    );
  }
}

function cleanupFiles(files) {
  if (!Array.isArray(files)) return;

  for (const file of files) {
    removeFile(file?.path);
  }
}

exports.processFromImages = async (req, res) => {
  const files = Array.isArray(req.files)
    ? req.files
    : [];

  let client;

  try {
    const userID = req.user?.userId;

    if (!userID) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Utente non autenticato",
      });
    }

    const mode = String(
      req.body?.mode || "summary"
    ).toLowerCase();

    if (
      ![
        "summary",
        "scientific",
        "oral",
      ].includes(mode)
    ) {
      return res.status(400).json({
        error: "STUDY_MODE_INVALID",
      });
    }

    const subscription =
      await getSubscriptionStatus(
        userID
      );

    const policy =
      getUsagePolicy(
        subscription.isPro
      );

    const limitCheck =
      await checkLimit(
        userID,
        "study_sessions",
        policy.studyDaily
      );

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

    if (!files.length) {
      return res.status(400).json({
        error: "NO_IMAGES",
        message: "Nessuna immagine fornita",
      });
    }

    if (
      files.length >
      policy.studyMaxImages
    ) {
      return res.status(400).json({
        error: "IMAGE_LIMIT_EXCEEDED",
        message:
          `Puoi elaborare al massimo ${policy.studyMaxImages} immagini.`,
        limit: policy.studyMaxImages,
      });
    }

    const visual = mode === "scientific" && req.body.shareScientificPhoto === "yes";
    const number = visual ? String(req.body.exerciseNumber || "").trim() : "";
    if (number && !/^\d{1,5}$/.test(number)) {
      return res.status(400).json({ message: "Numero di esercizio non valido." });
    }
    let rawText = "";

    for (const file of (visual ? [] : files)) {
      const text =
        await ocrService
          .extractTextFromImages(
            [file]
          );

      rawText +=
        `\n${text || ""}`;
    }

    rawText =
      rawText.trim();

    if (!visual && rawText.length < 15) {
      return res.status(400).json({
        error: "OCR_TEXT_TOO_SHORT",
        message:
          "Il testo nelle immagini non è abbastanza leggibile.",
      });
    }

    const payload = {
      limit: policy.studyDaily,
      isPro: subscription.isPro,
      ocrText: rawText,
    };

    if (mode === "summary") {
      payload.summary =
        await aiService
          .generateSummary(rawText, outputLanguage(req, true));

      if (
        !payload.summary ||
        payload.summary
          .startsWith("Errore")
      ) {
        throw new Error(
          "SUMMARY_GENERATION_FAILED"
        );
      }
    }

    if (mode === "scientific") {
      const solution =
        await aiService
          .solveScientificGuided(
            rawText, visual ? { files, number } : undefined, outputLanguage(req)
          );

      if (
        !solution ||
        !solution.finalAnswer
      ) {
        return res.status(400).json({
          error:
            "SCIENTIFIC_NOT_SOLVABLE",
          message:
            "Impossibile risolvere il problema scientifico",
        });
      }

      if (solution.fallback) {
        return res.status(422).json({
          error: "SCIENTIFIC_CLARIFICATION",
          message: solution.clarification || "Controlla il numero dell’esercizio e la leggibilità della formula.",
        });
      }

      if (visual) {
        rawText = solution.exerciseText;
        payload.ocrText = rawText;
      }
      payload.solutionSteps =
        Array.isArray(
          solution.steps
        )
          ? solution.steps
          : [];

      payload.finalAnswer =
        solution.finalAnswer;

      payload.fallback =
        Boolean(
          solution.fallback
        );
    }

    const selectedSubject = mode === "oral" ? req.body?.oralSubject : null;
    if (selectedSubject && !supportedSubject(selectedSubject)) {
      return res.status(400).json({ error: "INVALID_ORAL_SUBJECT" });
    }
    if (mode === "oral") {
      payload.summary =
        await aiService
          .generateOralSummary(
            rawText, outputLanguage(req) + subjectInstruction(selectedSubject)
          );

      if (
        !payload.summary ||
        payload.summary
          .startsWith("Errore")
      ) {
        throw new Error(
          "ORAL_SUMMARY_GENERATION_FAILED"
        );
      }
    }

    const subject = selectedSubject ||
      detectSubjectFromText(
        rawText
      );

    client = await db.getClient();
    await client.query("BEGIN");
    await client.query("SELECT userid FROM users WHERE userid = $1 FOR UPDATE", [userID]);
    const available = await checkLimit(userID, "study_sessions", policy.studyDaily, client);
    if (!available.allowed) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "STUDY_DAILY_LIMIT", feature: "study_sessions",
        limit: policy.studyDaily, remaining: 0, isPro: subscription.isPro });
    }
    const sessionResult =
      await client.query(
        `INSERT INTO study_sessions
           (userid, subject, type, rawtext, createdat, scientific_solution)
         VALUES
           ($1, $2, $3, $4, NOW(), $5::jsonb)
         RETURNING sessionid`,
        [
          userID,
          subject,
          mode,
          rawText,
          mode === "scientific" ? JSON.stringify({
            solutionSteps: payload.solutionSteps, finalAnswer: payload.finalAnswer,
          }) : null,
        ]
      );

    const createdSessionID =
      sessionResult
        .rows[0]
        .sessionid;

    payload.sessionID =
      createdSessionID;

    if (payload.summary) {
      await client.query(
        `INSERT INTO study_summaries
           (sessionid, summary)
         VALUES
           ($1, $2)`,
        [
          createdSessionID,
          payload.summary,
        ]
      );
    }

    await incrementUsage(
      userID,
      "study_sessions", client
    );
    await client.query("COMMIT");

    payload.remaining =
      Math.max(
        0,
        Number(
          available.remaining || 0
        ) - 1
      );

    return res.json(payload);
  } catch (err) {
    console.error(
      "processFromImages:",
      err
    );

    if (client) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) {
        console.error("Study rollback:", rollbackError.message);
      }
    }

    return res.status(500).json({
      error: "STUDY_PROCESSING_ERROR",
      message:
        "Non è stato possibile elaborare il contenuto.",
    });
  } finally {
    client?.release();
    cleanupFiles(files);
  }
};


exports.explainScientificStep = async (req, res) => {
  try {
    const userID = req.user?.userId;

    if (!userID) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    const sessionID =
      Number(req.body?.sessionID);

    const stepNumber =
      Number(req.body?.stepNumber);

    const step =
      String(req.body?.step || "")
        .trim();

    if (
      !Number.isInteger(sessionID) ||
      sessionID <= 0
    ) {
      return res.status(400).json({
        error: "SESSION_INVALID",
      });
    }

    if (
      !Number.isInteger(stepNumber) ||
      stepNumber <= 0 ||
      stepNumber > 100
    ) {
      return res.status(400).json({
        error: "STEP_NUMBER_INVALID",
      });
    }

    if (
      !step ||
      step.length > 2000
    ) {
      return res.status(400).json({
        error: "STEP_INVALID",
      });
    }

    /*
     * Recuperiamo l'esercizio originale
     * direttamente dal DB.
     * Inoltre verifichiamo che appartenga
     * realmente all'utente.
     */
    const sessionQ =
      await db.query(
        `
        SELECT
          sessionid,
          rawtext
        FROM study_sessions
        WHERE sessionid = $1
          AND userid = $2
          AND type = 'scientific'
        LIMIT 1
        `,
        [
          sessionID,
          userID,
        ]
      );

    if (!sessionQ.rows.length) {
      return res.status(404).json({
        error:
          "SCIENTIFIC_SESSION_NOT_FOUND",
      });
    }

    const exerciseText =
      sessionQ.rows[0].rawtext || "";

    const explanation =
      await aiService.explainScientificStep(
        exerciseText,
        step,
        stepNumber, outputLanguage(req)
      );

    if (
      !explanation ||
      !explanation.explanation
    ) {
      throw new Error(
        "STEP_EXPLANATION_FAILED"
      );
    }

    const savedStep = { step, explanation: explanation.explanation,
      why: explanation.why || "", rule: explanation.rule || "" };
    await db.query(
      `UPDATE study_sessions SET scientific_solution =
         COALESCE(scientific_solution, '{}'::jsonb) ||
         jsonb_build_object('explanations',
           COALESCE(scientific_solution->'explanations', '{}'::jsonb) ||
           jsonb_build_object($3::text, $4::jsonb))
       WHERE sessionid = $1 AND userid = $2 AND type = 'scientific'`,
      [sessionID, userID, String(stepNumber), JSON.stringify(savedStep)]
    );

    return res.json({
      sessionID,
      stepNumber,

      explanation:
        explanation.explanation,

      why:
        explanation.why || "",

      rule:
        explanation.rule || "",
    });

  } catch (err) {
    console.error(
      "explainScientificStep:",
      err
    );

    return res.status(500).json({
      error:
        "SCIENTIFIC_STEP_EXPLANATION_ERROR",
    });
  }
};

exports.evaluateOral = async (req, res) => {
  let client;
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
      `SELECT sessionid, rawtext, subject
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

    const rubric = await aiService.scoreOralAnswer(reference, transcript, outputLanguage(req) + subjectInstruction(sessionQ.rows[0].subject));
    if (!rubric || !Number.isFinite(rubric.voto_finale) || rubric.voto_finale < 0 || rubric.voto_finale > 10) {
      throw new Error("ORAL_RUBRIC_INVALID");
    }

    client = await db.getClient();
    await client.query("BEGIN");
    await client.query("SELECT userid FROM users WHERE userid = $1 FOR UPDATE", [userID]);
    const available = await checkLimit(userID, "oral_evaluations", policy.oralDaily, client);
    if (!available.allowed) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "LIMIT_EXCEEDED", feature: "oral_evaluations",
        limit: policy.oralDaily, remaining: 0, isPro: subscription.isPro });
    }
    await client.query(
      `INSERT INTO study_oral_evaluations
       (sessionid, userid, aisummary, useraudiourl, aifeedback, score, transcript, createdat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        sessionID,
        userID,
        reference,
        null,
        rubric.commento_prof || "",
        rubric.voto_finale,
        transcript,
      ]
    );

    await incrementUsage(userID, "oral_evaluations", client);
    await client.query("COMMIT");

    return res.json({
      subject: sessionQ.rows[0].subject,
      rubric,
      transcript,
      isPro: subscription.isPro,
      limit: policy.oralDaily,
      remaining: Math.max(0, Number(available.remaining || 0) - 1),
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("evaluateOral:", err);
    return res.status(500).json({ error: "Errore valutazione orale" });
  } finally {
    client?.release();
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
       WHERE userid = $1 AND NOT scientific_failed
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
    const userID =
      req.user?.userId;

    const sessionID =
      Number(
        req.params?.sessionID
      );

    if (!userID) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
      });
    }

    if (
      !Number.isInteger(
        sessionID
      ) ||
      sessionID <= 0
    ) {
      return res.status(400).json({
        error: "SESSION_INVALID",
      });
    }

    const result =
      await db.query(
        `SELECT
           s.sessionid AS "sessionID",
           s.subject,
           s.type,
           s.rawtext AS "rawText",
           s.createdat AS "createdAt",
           s.rating,
           ss.summary,
           s.scientific_solution AS solution,
           NULL::text AS "audioUrl"
         FROM study_sessions s

         LEFT JOIN LATERAL (
           SELECT summary
           FROM study_summaries
           WHERE sessionid = s.sessionid
           ORDER BY summaryid DESC
           LIMIT 1
         ) ss ON TRUE

         WHERE s.sessionid = $1
           AND s.userid = $2 AND NOT s.scientific_failed`,
        [
          sessionID,
          userID,
        ]
      );

    const session = result.rows[0];
    if (!session) return res.json(null);
    const { solution, ...detail } = session;
    if (detail.type === "summary" || detail.type === "oral") detail.summary = plainSummary(detail.summary);
    if (detail.type === "oral") {
      const { rows } = await db.query(
        `SELECT score, aifeedback AS comment, createdat FROM study_oral_evaluations
         WHERE sessionid = $1 AND userid = $2 AND score IS NOT NULL ORDER BY createdat DESC`,
        [sessionID, userID]
      );
      detail.evaluations = rows;
    }
    if (detail.type === "scientific") {
      Object.assign(detail, solution || {});
      if (!detail.solutionSteps && !detail.finalAnswer) {
        // Some databases imported older solutions into study_problems.
        const { rows } = await db.query("SELECT to_regclass('study_problems') AS legacy");
        if (rows[0].legacy) {
          const history = await db.query(
            `SELECT solutionsteps, finalanswer FROM study_problems
             WHERE sessionid = $1 ORDER BY problemid DESC LIMIT 1`, [sessionID]
          );
          if (history.rows.length) {
            const { solutionsteps, finalanswer } = history.rows[0];
            let steps = solutionsteps;
            try {
              const parsed = JSON.parse(steps);
              if (Array.isArray(parsed)) steps = parsed;
            } catch { /* Older records may contain plain text. */ }
            detail.solutionSteps = steps;
            detail.finalAnswer = finalanswer;
          }
        }
      }
    }
    return res.json(detail);
  } catch (err) {
    console.error(
      "getStudySession:",
      err
    );

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
      `SELECT COALESCE(to_jsonb(e)->>'oralid', to_jsonb(e)->>'id') AS id, score, aifeedback AS comment, createdat
       FROM study_oral_evaluations e
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
       WHERE userid = $1 AND NOT scientific_failed`,
      [userID]
    );

    const oralQ = await db.query(
      `WITH graded AS (
         SELECT NULLIF(NULLIF(TRIM(s.subject), ''), 'Studio') AS subject, e.score
         FROM study_oral_evaluations e
         LEFT JOIN study_sessions s ON s.sessionid = e.sessionid AND s.userid = e.userid AND s.type = 'oral'
         WHERE e.userid = $1 AND e.score IS NOT NULL
       )
       SELECT subject, GROUPING(subject) AS is_total,
              COUNT(*)::int AS total_oral_evaluations,
              COUNT(*) FILTER (WHERE score >= 7)::int AS strong_orals,
              AVG(score)::float AS avg_oral_score
       FROM graded GROUP BY GROUPING SETS ((), (subject))
       ORDER BY is_total DESC, subject NULLS LAST`,
      [userID]
    );

    const quizQ = await db.query(
      `SELECT COUNT(*)::int AS completed_quizzes FROM attempts
       WHERE userid = $1 AND completedat IS NOT NULL`,
      [userID]
    );

    const byDayQ = await db.query(
      `WITH days AS (
         SELECT generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day')::date AS day
       ), activity AS (
         SELECT createdat::date AS day, 'study' AS kind FROM study_sessions
         WHERE userid = $1 AND NOT scientific_failed AND createdat >= CURRENT_DATE - 6
         UNION ALL
         SELECT completedat::date, 'quiz' FROM attempts
         WHERE userid = $1 AND completedat >= CURRENT_DATE - 6
         UNION ALL
         SELECT createdat::date, 'oral' FROM study_oral_evaluations
         WHERE userid = $1 AND createdat >= CURRENT_DATE - 6
       )
       SELECT TO_CHAR(days.day, 'DD/MM') AS label,
              COUNT(*) FILTER (WHERE kind = 'study')::int AS sessions,
              COUNT(activity.kind)::int AS activities
       FROM days LEFT JOIN activity USING (day)
       GROUP BY days.day ORDER BY days.day`,
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
      oralBySubject: oralQ.rows.filter(row => row.is_total === 0).map(row => ({
        subject: row.subject, count: row.total_oral_evaluations, average: row.avg_oral_score,
      })),
      completedQuizzes: quizQ.rows[0].completed_quizzes,
      strongOrals: oral.strong_orals,
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
      `SELECT COUNT(*)::int AS total_sessions FROM study_sessions WHERE NOT scientific_failed`
    );
    return res.json(q.rows[0]);
  } catch (err) {
    console.error("getGlobalStats:", err);
    return res.status(500).json({ error: "GLOBAL_STATS_ERROR" });
  }
};
