// controllers/quizPlayController.js
const db = require("../db");
const {
  QuizAttemptError, positiveId, choicesFor, correctAnswerFor, createQuizAttemptService,
} = require("../services/quizAttemptService");
const attempts = createQuizAttemptService(db);

function respondError(res, error, message) {
  if (error instanceof QuizAttemptError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(message, error);
  return res.status(500).json({ error: message });
}

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
    const quizID = positiveId(req.params.quizID);
    const userID = req.user.userId;


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
      choices: row.questiontype === "mcq" ? choicesFor(row) : null,
      points: row.points == null ? 1 : Number(row.points),
    }));

    res.json({ quiz: qQuiz.rows[0], questions });
  } catch (err) {
    respondError(res, err, "Errore nel recupero quiz");
  }
};

//
// GET /api/quiz/:quizID/attempts -> tentativi dell'utente
//
exports.getQuizAttempts = async (req, res) => {
  try {
    const quizID = positiveId(req.params.quizID);
    const userID = req.user.userId;

    const quiz = await db.query(
      "SELECT quizid FROM quizzes WHERE quizid = $1 AND userid = $2", [quizID, userID]
    );
    if (!quiz.rows.length) return res.status(404).json({ error: "Quiz non trovato" });

    const result = await db.query(
      `SELECT a.* FROM attempts a JOIN quizzes q ON q.quizid = a.quizid
       WHERE a.quizid = $1 AND a.userid = $2 AND q.userid = $2
       ORDER BY a.startedat DESC`,
      [quizID, userID]
    );

    res.json(result.rows);
  } catch (err) {
    respondError(res, err, "Errore nel recupero tentativi");
  }
};

//
// POST /api/quiz/:quizID/attempts -> inizia un nuovo tentativo
//
exports.createAttempt = async (req, res) => {
  try {
    const attemptID = await attempts.createAttempt(req.params.quizID, req.user.userId);
    res.json({ attemptID });
  } catch (error) {
    respondError(res, error, "Errore nella creazione del tentativo");
  }
};

exports.submitAnswers = async (req, res) => {
  try {
    const answers = Array.isArray(req.body) ? req.body : req.body?.answers;
    const result = await attempts.saveAnswersAndScore(
      req.params.quizID, req.params.attemptID, req.user.userId, answers
    );
    res.json(result);
  } catch (error) {
    respondError(res, error, "Errore nel salvataggio delle risposte");
  }
};

exports.getQuizHistory = async (req, res) => {
  try {
    const userID = req.user.userId;


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
      WHERE a.userid = $1 AND q.userid = $1
        AND a.completedat IS NOT NULL
      ORDER BY a.completedat DESC
      `,
      [userID]
    );


    res.json(rows);
  } catch (err) {
    console.error("❌ QUIZ HISTORY ERROR:", err);
    res.status(500).json({ error: "Errore cronologia quiz" });
  }
};

exports.getQuizAttemptDetail = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizID = positiveId(req.params.quizID);
    const attemptID = positiveId(req.params.attemptID);

    // Tentativo
    const attemptRes = await db.query(
      `
      SELECT
        a.attemptid,
        a.quizid,
        a.score,
        a.maxscore,
        a.startedat,
        a.completedat,
        a.ispassed
      FROM attempts a
      JOIN quizzes q ON q.quizid = a.quizid
      WHERE a.attemptid = $1
        AND a.quizid = $2
        AND a.userid = $3 AND q.userid = $3
      `,
      [attemptID, quizID, userID]
    );

    if (attemptRes.rows.length === 0) {
      return res.status(404).json({ error: "Tentativo non trovato" });
    }

    // Risposte
    const answersRes = await db.query(
      `
      SELECT
        an.questionid,
        q.questiontext,
        q.questiontype,
        q.choicesjson,
        q.correctanswer,
        an.answertext,
        an.iscorrect,
        an.score
      FROM answers an
      JOIN questions q ON q.questionid = an.questionid
      WHERE an.attemptid = $1 AND q.quizid = $2
      ORDER BY q.questionid ASC
      `,
      [attemptID, quizID]
    );

    res.json({
      attempt: attemptRes.rows[0],
      details: answersRes.rows.map(row => ({
        // Preserve raw fields for older clients and provide the fields the current app reads.
        questionid: row.questionid,
        questiontext: row.questiontext,
        answertext: row.answertext,
        iscorrect: row.iscorrect,
        score: row.score,
        questionID: row.questionid,
        questionText: row.questiontext,
        userAnswer: row.answertext,
        correct: row.iscorrect,
        correctAnswer: attemptRes.rows[0].completedat != null ? correctAnswerFor(row) : null,
      })),
    });
  } catch (err) {
    respondError(res, err, "Errore recupero tentativo");
  }
};
