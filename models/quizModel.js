const db = require("../db");
const { createQuizAttemptService } = require("../services/quizAttemptService");
const attemptService = createQuizAttemptService(db);

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
exports.createAttempt = (quizID, userID) =>
  attemptService.createAttempt(quizID, userID);

exports.saveAnswersAndScore = (quizID, attemptID, userID, answers) =>
  attemptService.saveAnswersAndScore(quizID, attemptID, userID, answers);

/* -----------------------------------------------------------
   ATTEMPT DETAIL (READ ONLY)
------------------------------------------------------------ */
exports.getAttemptDetail = async (quizID, attemptID, userID) => {
  // quiz
  const quizQ = await db.query(
    `
    SELECT title
    FROM quizzes
    WHERE quizid = $1 AND userid = $2
    `,
    [quizID, userID]
  );

  if (!quizQ.rows.length) return null;

  // attempt
  const attemptQ = await db.query(
    `
    SELECT score, maxscore, startedat
    FROM attempts
    WHERE attemptid = $1 AND quizid = $2 AND userid = $3
    `,
    [attemptID, quizID, userID]
  );

  if (!attemptQ.rows.length) return null;

  // answers + questions
  const detailQ = await db.query(
    `
    SELECT
      q.questionid       AS "questionID",
      q.questiontext     AS "questionText",
      a.iscorrect        AS "correct",
      a.answertext       AS "userAnswer",
      q.correctanswer    AS "correctAnswer"
    FROM answers a
    JOIN questions q ON q.questionid = a.questionid
    WHERE a.attemptid = $1
    ORDER BY q.questionid
    `,
    [attemptID]
  );

  return {
    quiz: {
      title: quizQ.rows[0].title,
    },
    attempt: attemptQ.rows[0],
    details: detailQ.rows,
  };
};
