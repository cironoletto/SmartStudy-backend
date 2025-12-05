const { getConnection, sql } = require("../db");

/**
 * Crea un quiz + domande in un'unica transazione
 */
exports.createQuizWithQuestions = async (quizData) => {
  console.log("📌 createQuizWithQuestions START");
  console.log("quizData:", JSON.stringify(quizData, null, 2));

  const pool = await getConnection();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    console.log("📌 INSERT QUIZ...");

    // 🔥 Request VA RICREAT0 per ogni query nella transaction
    let reqQuiz = new sql.Request(transaction);

    const quizResult = await reqQuiz.query(`
      INSERT INTO Quizzes (UserID, Title, Description, CreatedAt)
      OUTPUT INSERTED.QuizID
      VALUES (
        ${quizData.userID},
        N'${quizData.title.replace(/'/g, "''")}',
        N'${quizData.description.replace(/'/g, "''")}',
        GETDATE()
      )
    `);

    const quizID = quizResult.recordset[0].QuizID;
    console.log("📌 QUIZ ID:", quizID);

    console.log("📌 INSERT QUESTIONS:", quizData.questions.length);

    // 🔥 Ciclo domande
    for (const q of quizData.questions) {
      console.log("➡️ inserting question:", q.text);

      const type = q.type || "mcq";
      const text = q.text || "";
      const points = q.points || 1;

      const choicesJson =
        type === "mcq" && Array.isArray(q.choices)
          ? JSON.stringify(q.choices).replace(/'/g, "''")
          : null;

      let correctAnswer = null;
      if (type === "mcq" && typeof q.correctIndex === "number") {
        correctAnswer = String(q.correctIndex);
      } else if (type === "open" && q.idealAnswer) {
        correctAnswer = q.idealAnswer;
      }

      // 🔥 NUOVO request ad ogni ciclo
      let reqQ = new sql.Request(transaction);

      await reqQ.query(`
        INSERT INTO Questions 
        (QuizID, QuestionText, QuestionType, ChoicesJSON, CorrectAnswer, Points)
        VALUES (
          ${quizID},
          N'${text.replace(/'/g, "''")}',
          '${type}',
          ${choicesJson ? `N'${choicesJson}'` : "NULL"},
          ${correctAnswer ? `N'${correctAnswer.replace(/'/g, "''")}'` : "NULL"},
          ${points}
        )
      `);
    }

    await transaction.commit();
    console.log("📌 TRANSACTION COMMITTED");
    return quizID;

  } catch (err) {
    console.log("💥 DB QUIZ TRANSACTION ERROR:", err);
    await transaction.rollback();
    throw err;
  }
};

/**
 * Ritorna tutti i quiz dell'utente
 */
exports.getQuizzesByUser = async (userID) => {
  const pool = await getConnection();
  const result = await pool.request().query(`
    SELECT QuizID, Title, Description, CreatedAt
    FROM Quizzes
    WHERE UserID = ${userID}
    ORDER BY CreatedAt DESC
  `);
  return result.recordset;
};

/**
 * Restituisce quiz + domande
 */
exports.getQuizWithQuestions = async (quizID, userID) => {
  const pool = await getConnection();

  const quizResult = await pool.request().query(`
    SELECT QuizID, UserID, Title, Description, CreatedAt
    FROM Quizzes
    WHERE QuizID = ${quizID}
  `);

  if (quizResult.recordset.length === 0) return null;

  const quiz = quizResult.recordset[0];
  if (quiz.UserID !== userID) return null;

  const questionsResult = await pool.request().query(`
    SELECT QuestionID, QuestionText, QuestionType, ChoicesJSON, CorrectAnswer, Points
    FROM Questions
    WHERE QuizID = ${quizID}
    ORDER BY QuestionID
  `);

  return {
    quiz,
    questions: questionsResult.recordset.map((q) => ({
      questionID: q.QuestionID,
      text: q.QuestionText,
      type: q.QuestionType,
      choices: q.ChoicesJSON ? JSON.parse(q.ChoicesJSON) : null,
      correctAnswer: q.CorrectAnswer,
      points: q.Points,
    })),
  };
};

/**
 * createAttempt
 */
exports.createAttempt = async (quizID, userID) => {
  const pool = await getConnection();

  const result = await pool.request().query(`
    INSERT INTO Attempts (QuizID, UserID, StartedAt)
    OUTPUT INSERTED.AttemptID
    VALUES (${quizID}, ${userID}, GETDATE())
  `);

  return result.recordset[0].AttemptID;
};

/**
 * saveAnswersAndScore
 */
exports.saveAnswersAndScore = async (quizID, attemptID, userID, answers) => {
  const pool = await getConnection();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const req = new sql.Request(transaction);

    const qRes = await req.query(`
      SELECT QuestionID, QuestionType, CorrectAnswer, Points
      FROM Questions
      WHERE QuizID = ${quizID}
    `);

    const qMap = new Map();
    qRes.recordset.forEach((q) => {
      qMap.set(q.QuestionID, {
        type: q.QuestionType,
        correctAnswer: q.CorrectAnswer,
        points: q.Points || 1,
      });
    });

    let totalScore = 0;
    let maxScore = 0;

    for (const ans of answers) {
      const meta = qMap.get(ans.questionID);
      if (!meta) continue;

      maxScore += meta.points;

      let isCorrect = null;
      let score = 0;

      if (meta.type === "mcq") {
        const correctIndex =
          meta.correctAnswer != null ? parseInt(meta.correctAnswer, 10) : null;

        if (
          typeof ans.selectedIndex === "number" &&
          correctIndex !== null &&
          ans.selectedIndex === correctIndex
        ) {
          isCorrect = 1;
          score = meta.points;
        } else {
          isCorrect = 0;
        }
      }

      totalScore += score;

      let reqAns = new sql.Request(transaction);
      await reqAns.query(`
        INSERT INTO Answers (AttemptID, QuestionID, AnswerText, IsCorrect, Score)
        VALUES (
          ${attemptID},
          ${ans.questionID},
          ${
            ans.answerText
              ? `N'${ans.answerText.replace(/'/g, "''")}'`
              : "NULL"
          },
          ${isCorrect === null ? "NULL" : isCorrect},
          ${score}
        )
      `);
    }

    const percentage = maxScore > 0 ? totalScore / maxScore : 0;
    const isPassed = percentage >= 0.6 ? 1 : 0;

    let reqUpdate = new sql.Request(transaction);
    await reqUpdate.query(`
      UPDATE Attempts
      SET CompletedAt = GETDATE(),
          Score = ${totalScore},
          MaxScore = ${maxScore},
          IsPassed = ${isPassed}
      WHERE AttemptID = ${attemptID} AND UserID = ${userID}
    `);

    await transaction.commit();

    return {
      totalScore,
      maxScore,
      percentage,
      isPassed: !!isPassed,
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};
