// controllers/quizController.js
const quizModel = require("../models/quizModel");

/**
 * GET /api/quiz
 * Restituisce i quiz dell'utente loggato
 */
exports.getUserQuizzes = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizzes = await quizModel.getQuizzesByUser(userID);
    res.json(quizzes);
  } catch (err) {
    console.error("getUserQuizzes ERROR:", err);
    res.status(500).json({ error: "Errore nel recupero dei quiz" });
  }
};

/**
 * GET /api/quiz/:quizID
 * Quiz + domande
 */
exports.getQuizById = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizID = parseInt(req.params.quizID, 10);

    const data = await quizModel.getQuizWithQuestions(quizID, userID);

    if (!data) return res.status(404).json({ error: "Quiz non trovato" });
    res.json(data);
  } catch (err) {
    console.error("getQuizById ERROR:", err);
    res.status(500).json({ error: "Errore nel recupero del quiz" });
  }
};

/**
 * POST /api/quiz/:quizID/attempt
 * Avvia un nuovo tentativo
 */
exports.startQuizAttempt = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizID = parseInt(req.params.quizID, 10);

    const attemptID = await quizModel.createAttempt(quizID, userID);
    res.json({ attemptID });
  } catch (err) {
    console.error("startQuizAttempt ERROR:", err);
    res.status(500).json({ error: "Errore nella creazione del tentativo" });
  }
};

/**
 * POST /api/quiz/:quizID/attempt/:attemptID/answers
 */
exports.submitQuizAnswers = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizID = parseInt(req.params.quizID, 10);
    const attemptID = parseInt(req.params.attemptID, 10);
    const { answers } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: "Nessuna risposta inviata" });
    }

    const result = await quizModel.saveAnswersAndScore(
      quizID,
      attemptID,
      userID,
      answers
    );

    res.json(result);
  } catch (err) {
    console.error("submitQuizAnswers ERROR:", err);
    res.status(500).json({ error: "Errore nel salvataggio delle risposte" });
  }
};

/**
 * GET /api/quiz/:quizID/attempts
 */
exports.getQuizAttempts = async (req, res) => {
  try {
    const userID = req.user.userId;
    const quizID = parseInt(req.params.quizID, 10);

    const attempts = await quizModel.getAttemptsForQuiz(quizID, userID);
    res.json(attempts);
  } catch (err) {
    console.error("getQuizAttempts ERROR:", err);
    res.status(500).json({ error: "Errore nel recupero dei tentativi" });
  }
};
