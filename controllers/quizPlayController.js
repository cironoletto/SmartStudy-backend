// controllers/quizPlayController.js
const db = require("../db"); // nuovo db PostgreSQL

//
// GET /api/quiz -> tutti i quiz dell'utente
//
exports.listUserQuizzes = async (req, res) => {
  try {
    const userID = req.user.userId;

    const result = await db.query(
      "SELECT * FROM quizzes WHERE userid = $1 ORDER BY createdat DESC",
      [userID]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("listUserQuizzes error:", err);
    res.status(500).json({ error: "Errore nel recupero quiz" });
  }
};

//
// GET /api/quiz/:quizID -> dettagli quiz + domande
//
exports.getQuizDetail = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    console.log("🔍 QUIZ DETAIL req.user =", req.user);
    console.log("🔍 QUIZ DETAIL quizID =", quizID);

    // 1️⃣ Prendo il quiz
    const qQuiz = await db.query(
      "SELECT * FROM quizzes WHERE quizid = $1 AND userid = $2",
      [quizID, userID]
    );

    if (qQuiz.rows.length === 0) {
      return res.status(404).json({ error: "Quiz non trovato" });
    }

    // 2️⃣ Domande del quiz
    const qQuestions = await db.query(
      "SELECT * FROM questions WHERE quizid = $1 ORDER BY questionid ASC",
      [quizID]
    );

    const questions = qQuestions.rows.map((row) => ({
      questionID: row.questionid,
      text: row.questiontext,
      type: row.questiontype,
      choices: row.choicesjson ? JSON.parse(row.choicesjson) : null,
      points: row.points || 1,
    }));

    res.json({
  quiz: qQuiz.rows[0],
  questions: questions || [],
});
  } catch (err) {
    console.error("getQuizDetail error:", err);
    res.status(500).json({ error: "Errore nel recupero quiz" });
  }
};

//
// GET /api/quiz/:quizID/attempts -> tentativi dell'utente
//
exports.getQuizAttempts = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    const result = await db.query(
      "SELECT * FROM attempts WHERE quizid = $1 AND userid = $2 ORDER BY startedat DESC",
      [quizID, userID]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("getQuizAttempts error:", err);
    res.status(500).json({ error: "Errore nel recupero tentativi" });
  }
};

//
// POST /api/quiz/:quizID/attempts -> inizia un nuovo tentativo
//
exports.createAttempt = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    const result = await db.query(
      `INSERT INTO attempts (quizid, userid, startedat, score, maxscore, ispassed)
       VALUES ($1, $2, NOW(), 0, 0, NULL)
       RETURNING attemptid`,
      [quizID, userID]
    );

    res.json({ attemptID: result.rows[0].attemptid });
  } catch (err) {
    console.error("createAttempt error:", err);
    res.status(500).json({ error: "Errore nella creazione del tentativo" });
  }
};

//
// POST /api/quiz/:quizID/attempts/:attemptID/answers
//
exports.submitAnswers = async (req, res) => {
  try {
    const quizID = Number(req.params.quizID);
    const attemptID = Number(req.params.attemptID);
    const userID = req.user.userId;
    const answers = Array.isArray(req.body) ? req.body : req.body.answers;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: "Formato risposte non valido" });
    }

    const qQuestions = await db.query(
      "SELECT * FROM questions WHERE quizid = $1",
      [quizID]
    );

    const map = {};
    qQuestions.rows.forEach(q => (map[q.questionid] = q));

    let totalScore = 0;
    let maxScore = 0;
    const details = [];

    for (const a of answers) {
      const q = map[a.questionID];
      if (!q) continue;

      const points = q.points || 1;
      maxScore += points;

      let isCorrect = false;
      let userAnswer = null;
      let correctAnswer = null;
      let obtainedScore = 0;   // ✅ FIX CHIAVE

      if (q.questiontype === "mcq") {
        const choices = q.choicesjson ? JSON.parse(q.choicesjson) : [];
        userAnswer = choices[a.selectedIndex] ?? null;
        correctAnswer = choices[Number(q.correctanswer)] ?? null;

        if (a.selectedIndex === Number(q.correctanswer)) {
          isCorrect = true;
          obtainedScore = points;
          totalScore += points;
        }
      }

      if (q.questiontype === "open") {
        userAnswer = (a.answerText || "").trim();
        correctAnswer = q.correctanswer;

        if (
          correctAnswer &&
          userAnswer &&
          userAnswer.toLowerCase() === correctAnswer.toLowerCase()
        ) {
          isCorrect = true;
          obtainedScore = points;
          totalScore += points;
        }
      }

      await db.query(
        `INSERT INTO answers
         (attemptid, questionid, answertext, iscorrect, score, audiourl)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          attemptID,
          a.questionID,
          userAnswer,
          isCorrect,
          obtainedScore,           // ✅ NON obtained
          a.audioUrl || null,
        ]
      );

      details.push({
        questionID: a.questionID,
        correct: isCorrect,
        correctAnswer,
        userAnswer,
      });
    }

    await db.query(
      `UPDATE attempts
       SET completedat = NOW(),
           score = $1,
           maxscore = $2
       WHERE attemptid = $3 AND userid = $4`,
      [totalScore, maxScore, attemptID, userID]
    );

    res.json({
      totalScore,
      maxScore,
      details,
    });
  } catch (err) {
    console.error("submitAnswers error:", err);
    res.status(500).json({ error: "Errore submit risposte" });
  }
};



exports.getQuizHistory = async (req, res) => {
  try {
    const userID = req.user.userId;

    console.log("📊 QUIZ HISTORY for user:", userID);

    const { rows } = await db.query(
      `
      SELECT
        q.quizid            AS "quizID",
        q.title             AS "title",
        a.attemptid         AS "attemptID",
        a.score             AS "score",
        a.maxscore          AS "maxScore",
        a.ispassed          AS "isPassed",
        a.completedat       AS "completedAt"
      FROM attempts a
      JOIN quizzes q ON q.quizid = a.quizid
      WHERE a.userid = $1
        AND a.completedat IS NOT NULL
      ORDER BY a.completedat DESC
      `,
      [userID]
    );

    console.log("📊 QUIZ HISTORY rows:", rows.length);

    res.json(rows);
  } catch (err) {
    console.error("❌ QUIZ HISTORY ERROR:", err);
    res.status(500).json({ error: "Errore cronologia quiz" });
  }
};
