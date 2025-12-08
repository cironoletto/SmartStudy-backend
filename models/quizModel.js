const db = require("../db");

/* -----------------------------------------------------------
   CREA QUIZ + DOMANDE (TRANSAZIONE POSTGRESQL)
------------------------------------------------------------ */
exports.createQuizWithQuestions = async (quizData) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Inserisci quiz
    const quizInsert = await client.query(
      `
      INSERT INTO quizzes (userid, title, description, createdat)
      VALUES ($1, $2, $3, NOW())
      RETURNING quizid
      `,
      [quizData.userID, quizData.title, quizData.description]
    );

    const quizID = quizInsert.rows[0].quizid;

    // 2️⃣ Inserisci domande
    for (const q of quizData.questions) {
      const type = q.type || "mcq";
      const points = q.points || 1;

      let choices = null;
      let correctAnswer = null;

      if (type === "mcq") {
        choices = Array.isArray(q.choices) ? JSON.stringify(q.choices) : null;
        correctAnswer =
          typeof q.correctIndex === "number"
            ? String(q.correctIndex)
            : null;
      } else if (type === "open") {
        correctAnswer = q.idealAnswer || null;
      }

      await client.query(
        `
        INSERT INTO questions
          (quizid, questiontext, questiontype, choicesjson, correctanswer, points)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          quizID,
          q.text || "",
          type,
          choices,
          correctAnswer,
          points,
        ]
      );
    }

    await client.query("COMMIT");
    return quizID;

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ PG TRANSACTION ERROR:", err);
    throw err;
  } finally {
    client.release();
  }
};

/* -----------------------------------------------------------
   QUIZ BY USER
------------------------------------------------------------ */
exports.getQuizzesByUser = async (userID) => {
  const result = await db.query(
    `
    SELECT quizid, title, description, createdat
    FROM quizzes
    WHERE userid = $1
    ORDER BY createdat DESC
    `,
    [userID]
  );

  return result.rows;
};

/* -----------------------------------------------------------
   QUIZ + DOMANDE
------------------------------------------------------------ */
exports.getQuizWithQuestions = async (quizID, userID) => {
  const quiz = await db.query(
    `
    SELECT quizid, userid, title, description, createdat
    FROM quizzes
    WHERE quizid = $1
    `,
    [quizID]
  );

  if (quiz.rows.length === 0) return null;
  if (quiz.rows[0].userid !== userID) return null;

  const q = await db.query(
    `
    SELECT questionid, questiontext, questiontype, choicesjson, correctanswer, points
    FROM questions
    WHERE quizid = $1
    ORDER BY questionid
    `,
    [quizID]
  );

  return {
    quiz: quiz.rows[0],
    questions: q.rows.map((x) => ({
      questionID: x.questionid,
      text: x.questiontext,
      type: x.questiontype,
      choices: x.choicesjson ? JSON.parse(x.choicesjson) : null,
      correctAnswer: x.correctanswer,
      points: x.points,
    })),
  };
};

/* -----------------------------------------------------------
   CREATE ATTEMPT
------------------------------------------------------------ */
exports.createAttempt = async (quizID, userID) => {
  const insert = await db.query(
    `
    INSERT INTO attempts (quizid, userid, startedat)
    VALUES ($1, $2, NOW())
    RETURNING attemptid
    `,
    [quizID, userID]
  );

  return insert.rows[0].attemptid;
};

/* -----------------------------------------------------------
   SAVE ANSWERS & SCORE (TRANSAZIONE PG)
------------------------------------------------------------ */
exports.saveAnswersAndScore = async (quizID, attemptID, userID, answers) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // Fetch domande
    const qRes = await client.query(
      `
      SELECT questionid, questiontype, correctanswer, points
      FROM questions
      WHERE quizid = $1
      `,
      [quizID]
    );

    const qMap = new Map();
    qRes.rows.forEach((q) => {
      qMap.set(q.questionid, {
        type: q.questiontype,
        correctAnswer: q.correctanswer,
        points: q.points || 1,
      });
    });

    let totalScore = 0;
    let maxScore = 0;

    // Inserisci risposte
    for (const ans of answers) {
      const meta = qMap.get(ans.questionID);
      if (!meta) continue;

      maxScore += meta.points;

      let isCorrect = false;
      let score = 0;

      if (meta.type === "mcq") {
        const correctIndex =
          meta.correctAnswer != null ? parseInt(meta.correctAnswer) : null;

        if (ans.selectedIndex === correctIndex) {
          isCorrect = true;
          score = meta.points;
        }
      }

      await client.query(
        `
        INSERT INTO answers (attemptid, questionid, answertext, iscorrect, score)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          attemptID,
          ans.questionID,
          ans.answerText || null,
          isCorrect,
          score,
        ]
      );

      totalScore += score;
    }

    const percentage = maxScore > 0 ? totalScore / maxScore : 0;
    const isPassed = percentage >= 0.6;

    await client.query(
      `
      UPDATE attempts
      SET completedat = NOW(),
          score = $1,
          maxscore = $2,
          ispassed = $3
      WHERE attemptid = $4 AND userid = $5
      `,
      [totalScore, maxScore, isPassed, attemptID, userID]
    );

    await client.query("COMMIT");

    return { totalScore, maxScore, percentage, isPassed };

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ saveAnswersAndScore ERROR:", err);
    throw err;

  } finally {
    client.release();
  }
};
