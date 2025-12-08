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
      questions,
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
    const quizID = parseInt(req.params.quizID);
    const attemptID = parseInt(req.params.attemptID);
    const userID = req.user.userId;
    const answers = req.body.answers || [];

    // 1️⃣ Domande
    const qQuestions = await db.query(
      "SELECT * FROM questions WHERE quizid = $1",
      [quizID]
    );

    const questionsMap = {};
    qQuestions.rows.forEach((q) => {
      questionsMap[q.questionid] = q;
    });

    let totalScore = 0;
    let maxScore = 0;

    const details = [];

    // 2️⃣ Ciclo risposte
    for (const a of answers) {
      const q = questionsMap[a.questionID];
      if (!q) continue;

      const points = q.points || 1;
      maxScore += points;

      let isCorrect = false;
      let obtained = 0;

      let userAnswer = a.answerText || null;
      let correctAnswer = null;

      // MULTIPLE CHOICE
      if (q.questiontype === "mcq") {
        const correctIndex = parseInt(q.correctanswer);
        const userIndex = a.selectedIndex;

        const choices = q.choicesjson ? JSON.parse(q.choicesjson) : [];

        userAnswer = choices[userIndex] || null;
        correctAnswer = choices[correctIndex] || null;

        if (userIndex === correctIndex) {
          isCorrect = true;
          obtained = points;
        }
      }
      // OPEN ANSWER
      else if (q.questiontype === "open") {
        correctAnswer = q.correctanswer || "";
        userAnswer = (a.answerText || "").trim();

        if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
          isCorrect = true;
          obtained = points;
        }
      }

      totalScore += obtained;

      // Salva risposta nel DB PostgreSQL
      await db.query(
        `INSERT INTO answers (attemptid, questionid, answertext, iscorrect, score)
         VALUES ($1, $2, $3, $4, $5)`,
        [attemptID, a.questionID, userAnswer, isCorrect, obtained]
      );

      details.push({
        questionID: a.questionID,
        correct: isCorrect,
        userAnswer,
        correctAnswer,
      });
    }

    // 3️⃣ aggiorna il tentativo
    const isPassed = totalScore >= Math.round(maxScore * 0.6);

    await db.query(
      `UPDATE attempts
       SET score = $1, maxscore = $2, ispassed = $3, completedat = NOW()
       WHERE attemptid = $4 AND userid = $5`,
      [totalScore, maxScore, isPassed, attemptID, userID]
    );

    res.json({
      attemptID,
      totalScore,
      maxScore,
      isPassed,
      details,
    });
  } catch (err) {
    console.error("submitAnswers error:", err);
    res.status(500).json({ error: "Errore nel salvataggio risposte" });
  }
};
