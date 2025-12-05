// controllers/quizPlayController.js

const sql = require("mssql");
const db = require("../db"); // assicurati che questo punti al tuo file di connessione

// GET /api/quiz -> tutti i quiz dell'utente
exports.listUserQuizzes = async (req, res) => {
  try {
    const userID = req.user.userId;

    const pool = await db.getConnection();
    const result = await pool
      .request()
      .input("UserID", sql.Int, userID)
      .query("SELECT * FROM Quizzes WHERE UserID = @UserID ORDER BY CreatedAt DESC");

    res.json(result.recordset);
  } catch (err) {
    console.error("listUserQuizzes error:", err);
    res.status(500).json({ error: "Errore nel recupero quiz" });
  }
};

// GET /api/quiz/:quizID -> dettagli quiz + domande
exports.getQuizDetail = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    console.log("🔍 QUIZ DETAIL req.user =", req.user);
console.log("🔍 QUIZ DETAIL quizID =", quizID);

    const pool = await db.getConnection();

    const qQuiz = await pool
  .request()
  .input("QuizID", sql.Int, quizID)
  .input("UserID", sql.Int, userID)
  .query("SELECT * FROM Quizzes WHERE QuizID = @QuizID AND UserID = @UserID");

    if (qQuiz.recordset.length === 0) {
      return res.status(404).json({ error: "Quiz non trovato" });
    }

    const qQuestions = await pool
      .request()
      .input("QuizID", sql.Int, quizID)
      .query("SELECT * FROM Questions WHERE QuizID = @QuizID ORDER BY QuestionID ASC");

    const questions = qQuestions.recordset.map((row) => ({
      questionID: row.QuestionID,
      text: row.QuestionText,
      type: row.QuestionType,
      choices: row.ChoicesJSON ? JSON.parse(row.ChoicesJSON) : null,
      points: row.Points || 1,
    }));

    res.json({
      quiz: qQuiz.recordset[0],
      questions,
    });
  } catch (err) {
    console.error("getQuizDetail error:", err);
    res.status(500).json({ error: "Errore nel recupero quiz" });
  }
};

// GET /api/quiz/:quizID/attempts -> tentativi dell'utente
exports.getQuizAttempts = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    const pool = await db.getConnection();
    const result = await pool
      .request()
      .input("QuizID", sql.Int, quizID)
      .input("UserID", sql.Int, userID)
      .query(
        "SELECT * FROM Attempts WHERE QuizID = @QuizID AND UserID = @UserID ORDER BY StartedAt DESC"
      );

    res.json(result.recordset);
  } catch (err) {
    console.error("getQuizAttempts error:", err);
    res.status(500).json({ error: "Errore nel recupero tentativi" });
  }
};

// POST /api/quiz/:quizID/attempts -> inizia un nuovo tentativo
exports.createAttempt = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const userID = req.user.userId;

    const pool = await db.getConnection();
    const result = await pool
      .request()
      .input("QuizID", sql.Int, quizID)
      .input("UserID", sql.Int, userID)
      .query(
        "INSERT INTO Attempts (QuizID, UserID, StartedAt, Score, MaxScore, IsPassed) " +
          "OUTPUT INSERTED.AttemptID VALUES (@QuizID, @UserID, GETDATE(), 0, 0, NULL)"
      );

    res.json({ attemptID: result.recordset[0].AttemptID });
  } catch (err) {
    console.error("createAttempt error:", err);
    res.status(500).json({ error: "Errore nella creazione del tentativo" });
  }
};

// POST /api/quiz/:quizID/attempts/:attemptID/answers -> salvataggio risposte + punteggio
exports.submitAnswers = async (req, res) => {
  try {
    const quizID = parseInt(req.params.quizID);
    const attemptID = parseInt(req.params.attemptID);
    const userID = req.user.userId;
    const answers = req.body.answers || [];

    const pool = await db.getConnection();

    // 1) prendo le domande
    const qQuestions = await pool
      .request()
      .input("QuizID", sql.Int, quizID)
      .query("SELECT * FROM Questions WHERE QuizID = @QuizID");

    const questionsMap = {};
    qQuestions.recordset.forEach((q) => {
      questionsMap[q.QuestionID] = q;
    });

    let totalScore = 0;
    let maxScore = 0;

    const details = []; // 👈 QUI RACCOGLIAMO RISPOSTE, CORRETTEZZA E RISPOSTE IDEALI

    // 2) ciclo risposte
    for (const a of answers) {
      const q = questionsMap[a.questionID];
      if (!q) continue;

      const points = q.Points || 1;
      maxScore += points;

      let isCorrect = false;
      let obtained = 0;

      let userAnswer = a.answerText || null;
      let correctAnswer = null;

      // 🔹 MULTIPLE CHOICE
      if (q.QuestionType === "mcq") {
        const correctIndex = parseInt(q.CorrectAnswer);
        const userIndex = a.selectedIndex;

        const choices = q.ChoicesJSON ? JSON.parse(q.ChoicesJSON) : [];

        userAnswer = choices[userIndex] || null;
        correctAnswer = choices[correctIndex] || null;

        if (userIndex === correctIndex) {
          isCorrect = true;
          obtained = points;
        }

      } 
      // 🔹 OPEN ANSWER
      else if (q.QuestionType === "open") {
        correctAnswer = q.CorrectAnswer || "";
        userAnswer = a.answerText?.trim() || "";

        if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
          isCorrect = true;
          obtained = points;
        }
      }

      totalScore += obtained;

      // Salva singola risposta DB
      await pool
        .request()
        .input("AttemptID", sql.Int, attemptID)
        .input("QuestionID", sql.Int, a.questionID)
        .input("AnswerText", sql.NVarChar(sql.MAX), userAnswer)
        .input("IsCorrect", sql.Bit, isCorrect ? 1 : 0)
        .input("Score", sql.Int, obtained)
        .query(
          "INSERT INTO Answers (AttemptID, QuestionID, AnswerText, IsCorrect, Score) " +
          "VALUES (@AttemptID, @QuestionID, @AnswerText, @IsCorrect, @Score)"
        );

      // 👇 aggiungo informazioni al dettaglio per il FRONTEND
      details.push({
        questionID: a.questionID,
        correct: isCorrect,
        userAnswer,
        correctAnswer
      });
    }

    // 3) aggiorno tentativo
    const isPassed = totalScore >= Math.round(maxScore * 0.6);

    await pool
      .request()
      .input("AttemptID", sql.Int, attemptID)
      .input("UserID", sql.Int, userID)
      .input("Score", sql.Int, totalScore)
      .input("MaxScore", sql.Int, maxScore)
      .input("IsPassed", sql.Bit, isPassed)
      .query(
        "UPDATE Attempts SET Score=@Score, MaxScore=@MaxScore, IsPassed=@IsPassed, CompletedAt=GETDATE() " +
        "WHERE AttemptID=@AttemptID AND UserID=@UserID"
      );

    // 🔥 RISPOSTA COMPLETA PER IL FRONTEND
    res.json({
      attemptID,
      totalScore,
      maxScore,
      isPassed,
      details // 👈 nuova parte fondamentale
    });

  } catch (err) {
    console.error("submitAnswers error:", err);
    res.status(500).json({ error: "Errore nel salvataggio risposte" });
  }
};

