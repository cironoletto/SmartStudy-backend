// Shared by the active API and the legacy model: one scoring and save path.
class QuizAttemptError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function positiveId(value) {
  const validType = typeof value === "number" ||
    (typeof value === "string" && /^[1-9]\d*$/.test(value));
  const number = Number(value);
  if (!validType || !Number.isSafeInteger(number) || number <= 0) {
    throw new QuizAttemptError(400, "Identificativo non valido");
  }
  return number;
}

function choicesFor(question) {
  const choices = typeof question.choicesjson === "string"
    ? JSON.parse(question.choicesjson) : question.choicesjson;
  if (!Array.isArray(choices) || choices.length === 0 ||
      choices.some(choice => typeof choice !== "string")) {
    throw new Error("Invalid quiz choices");
  }
  return choices;
}

function correctAnswerFor(question) {
  if (question.questiontype !== "mcq") return question.correctanswer || null;
  const choices = choicesFor(question);
  const raw = question.correctanswer;
  const index = Number(raw);
  if (raw === null || raw === undefined || String(raw).trim() === "" ||
      !Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new Error("Invalid quiz correct answer");
  }
  return choices[index];
}

function scoreAnswers(questions, answers) {
  if (!Array.isArray(answers)) {
    throw new QuizAttemptError(400, "Formato risposte non valido");
  }
  if (!questions.length) {
    throw new QuizAttemptError(409, "Il quiz non contiene domande");
  }
  const questionIds = new Set(questions.map(q => positiveId(q.questionid)));
  const submitted = new Map();
  for (const answer of answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw new QuizAttemptError(400, "Formato risposta non valido");
    }
    const id = positiveId(answer.questionID);
    if (!questionIds.has(id)) {
      throw new QuizAttemptError(400, "La domanda non appartiene al quiz");
    }
    if (submitted.has(id)) {
      throw new QuizAttemptError(400, "Una domanda contiene piu risposte");
    }
    if (answer.audioUrl != null && typeof answer.audioUrl !== "string") {
      throw new QuizAttemptError(400, "Formato audio non valido");
    }
    submitted.set(id, answer);
  }

  let totalScore = 0;
  let maxScore = 0;
  const details = questions.map(question => {
    const questionID = positiveId(question.questionid);
    const answer = submitted.get(questionID) || {};
    const points = question.points == null ? 1 : Number(question.points);
    if (!Number.isSafeInteger(points) || points < 0) {
      throw new Error("Invalid quiz points");
    }
    maxScore += points;
    let userAnswer = ""; // compatible with answers.answertext NOT NULL
    let correct = false;
    const correctAnswer = correctAnswerFor(question);
    if (question.questiontype === "mcq") {
      const choices = choicesFor(question);
      if (answer.selectedIndex != null) {
        if (!Number.isInteger(answer.selectedIndex) || answer.selectedIndex < 0 ||
            answer.selectedIndex >= choices.length) {
          throw new QuizAttemptError(400, "Scelta della risposta non valida");
        }
        userAnswer = choices[answer.selectedIndex];
        correct = answer.selectedIndex === Number(question.correctanswer);
      }
    } else if (question.questiontype === "open") {
      if (answer.answerText != null && typeof answer.answerText !== "string") {
        throw new QuizAttemptError(400, "Testo della risposta non valido");
      }
      userAnswer = (answer.answerText || "").trim();
      // Keep the existing exact-match rule; semantic grading is a separate feature.
      correct = !!userAnswer && typeof correctAnswer === "string" &&
        userAnswer.toLowerCase() === correctAnswer.trim().toLowerCase();
    } else {
      throw new Error("Unsupported quiz question type");
    }
    const score = correct ? points : 0;
    totalScore += score;
    return {
      questionID, questionText: question.questiontext, correct, correctAnswer,
      userAnswer, score, audioUrl: answer.audioUrl || null,
    };
  });
  if (!Number.isSafeInteger(maxScore) || !Number.isSafeInteger(totalScore)) {
    throw new Error("Invalid quiz total points");
  }
  const percentage = maxScore > 0 ? totalScore / maxScore : 0;
  // Same 60% threshold already used by quizModel.saveAnswersAndScore.
  return { totalScore, maxScore, percentage, isPassed: maxScore > 0 && percentage >= 0.6, details };
}

function createQuizAttemptService(db) {
  return {
    async createAttempt(quizID, userID) {
      quizID = positiveId(quizID);
      userID = positiveId(userID);
      // One statement: a foreign or missing quiz cannot create a row.
      const result = await db.query(
        `INSERT INTO attempts (quizid, userid, startedat, score, maxscore, ispassed)
         SELECT quizid, userid, NOW(), 0, 0, NULL
         FROM quizzes WHERE quizid = $1 AND userid = $2
         RETURNING attemptid`,
        [quizID, userID]
      );
      if (!result.rows.length) throw new QuizAttemptError(404, "Quiz non trovato");
      return result.rows[0].attemptid;
    },

    async saveAnswersAndScore(quizID, attemptID, userID, answers) {
      quizID = positiveId(quizID);
      attemptID = positiveId(attemptID);
      userID = positiveId(userID);
      if (!Array.isArray(answers)) {
        throw new QuizAttemptError(400, "Formato risposte non valido");
      }
      const client = await db.getClient();
      let inTransaction = false;
      try {
        await client.query("BEGIN");
        inTransaction = true;
        // Serialize concurrent submissions and check ownership BEFORE reading answers.
        const attempt = await client.query(
          `SELECT a.attemptid, a.completedat
           FROM attempts a JOIN quizzes q ON q.quizid = a.quizid
           WHERE a.attemptid = $1 AND a.quizid = $2
             AND a.userid = $3 AND q.userid = $3
           FOR UPDATE OF a`,
          [attemptID, quizID, userID]
        );
        if (!attempt.rows.length) throw new QuizAttemptError(404, "Tentativo non trovato");
        if (attempt.rows[0].completedat != null) {
          throw new QuizAttemptError(409, "Tentativo gia completato. Apri la cronologia per vedere il risultato.");
        }
        const existing = await client.query(
          "SELECT 1 FROM answers WHERE attemptid = $1 LIMIT 1", [attemptID]
        );
        if (existing.rows.length) {
          throw new QuizAttemptError(409, "Tentativo con risposte gia presenti. Avvia un nuovo tentativo.");
        }
        const questions = await client.query(
          "SELECT * FROM questions WHERE quizid = $1 ORDER BY questionid ASC FOR SHARE", [quizID]
        );
        // Validate the entire submission before inserting the first answer.
        const result = scoreAnswers(questions.rows, answers);
        for (const detail of result.details) {
          await client.query(
            `INSERT INTO answers (attemptid, questionid, answertext, iscorrect, score, audiourl)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [attemptID, detail.questionID, detail.userAnswer, detail.correct, detail.score, detail.audioUrl]
          );
        }
        const saved = await client.query(
          `UPDATE attempts SET completedat = NOW(), score = $1, maxscore = $2, ispassed = $3
           WHERE attemptid = $4 AND quizid = $5 AND userid = $6 AND completedat IS NULL`,
          [result.totalScore, result.maxScore, result.isPassed, attemptID, quizID, userID]
        );
        if (saved.rowCount !== 1) throw new Error("Attempt update failed");
        await client.query("COMMIT");
        inTransaction = false;
        return result;
      } catch (error) {
        if (inTransaction) {
          try { await client.query("ROLLBACK"); } catch (rollbackError) {
            console.error("Quiz rollback failed:", rollbackError);
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { QuizAttemptError, positiveId, choicesFor, correctAnswerFor, scoreAnswers, createQuizAttemptService };
