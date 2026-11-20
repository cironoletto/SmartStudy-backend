const db = require("../db");

const {
  QuizAttemptError,
  positiveId,
  choicesFor,
  correctAnswerFor,
  createQuizAttemptService,
} = require("../services/quizAttemptService");

const attempts =
  createQuizAttemptService(db);

function respondError(
  res,
  error,
  message
) {
  if (
    error instanceof
      QuizAttemptError
  ) {
    return res
      .status(error.status)
      .json({
        error: error.message,
      });
  }

  console.error(
    message,
    error
  );

  return res
    .status(500)
    .json({
      error: message,
    });
}

exports.listUserQuizzes =
  async (req, res) => {
    try {
      const userID =
        req.user?.userId;

      if (!userID) {
        return res
          .status(401)
          .json({
            error:
              "UNAUTHORIZED",
          });
      }

      const result =
        await db.query(
          `SELECT
             quizid,
             userid,
             title,
             description,
             createdat,
             requestid
           FROM quizzes
           WHERE userid = $1
           ORDER BY
             createdat DESC,
             quizid DESC`,
          [userID]
        );

      return res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "listUserQuizzes error:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "Errore nel recupero quiz",
        });
    }
  };

exports.getQuizDetail =
  async (req, res) => {
    try {
      const quizID =
        positiveId(
          req.params.quizID
        );

      const userID =
        req.user?.userId;

      if (!userID) {
        return res
          .status(401)
          .json({
            error:
              "UNAUTHORIZED",
          });
      }

      const quizResult =
        await db.query(
          `SELECT *
           FROM quizzes
           WHERE quizid = $1
             AND userid = $2`,
          [quizID, userID]
        );

      if (
        quizResult.rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Quiz non trovato",
          });
      }

      const questionResult =
        await db.query(
          `SELECT *
           FROM questions
           WHERE quizid = $1
           ORDER BY questionid ASC`,
          [quizID]
        );

      const questions =
        questionResult.rows.map(
          (row) => ({
            questionID:
              row.questionid,
            text:
              row.questiontext,
            type:
              row.questiontype,
            choices:
              row.questiontype ===
              "mcq"
                ? choicesFor(row)
                : null,
            points:
              row.points == null
                ? 1
                : Number(
                    row.points
                  ),
          })
        );

      return res.json({
        quiz:
          quizResult.rows[0],
        questions,
      });
    } catch (err) {
      return respondError(
        res,
        err,
        "Errore nel recupero quiz"
      );
    }
  };

exports.getQuizAttempts =
  async (req, res) => {
    try {
      const quizID =
        positiveId(
          req.params.quizID
        );

      const userID =
        req.user?.userId;

      if (!userID) {
        return res
          .status(401)
          .json({
            error:
              "UNAUTHORIZED",
          });
      }

      const quizResult =
        await db.query(
          `SELECT quizid
           FROM quizzes
           WHERE quizid = $1
             AND userid = $2`,
          [quizID, userID]
        );

      if (!quizResult.rows.length) {
        return res
          .status(404)
          .json({
            error:
              "Quiz non trovato",
          });
      }

      const result =
        await db.query(
          `SELECT
             a.attemptid AS "attemptID",
             a.quizid AS "quizID",
             a.userid AS "userID",
             a.startedat AS "startedAt",
             a.completedat AS "completedAt",
             COALESCE(a.score, 0) AS score,
             COALESCE(a.maxscore, 0) AS "maxScore",
             a.ispassed AS "isPassed"
           FROM attempts a
           INNER JOIN quizzes q
             ON q.quizid = a.quizid
           WHERE a.quizid = $1
             AND a.userid = $2
             AND q.userid = $2
           ORDER BY
             COALESCE(
               a.completedat,
               a.startedat
             ) DESC,
             a.attemptid DESC`,
          [quizID, userID]
        );

      return res.json(
        result.rows
      );
    } catch (err) {
      return respondError(
        res,
        err,
        "Errore nel recupero tentativi"
      );
    }
  };

exports.createAttempt =
  async (req, res) => {
    try {
      const attemptID =
        await attempts
          .createAttempt(
            req.params.quizID,
            req.user.userId
          );

      return res.json({
        attemptID,
      });
    } catch (error) {
      return respondError(
        res,
        error,
        "Errore nella creazione del tentativo"
      );
    }
  };

exports.submitAnswers =
  async (req, res) => {
    try {
      const submittedAnswers =
        Array.isArray(req.body)
          ? req.body
          : req.body?.answers;

      const result =
        await attempts
          .saveAnswersAndScore(
            req.params.quizID,
            req.params.attemptID,
            req.user.userId,
            submittedAnswers
          );

      return res.json(result);
    } catch (error) {
      return respondError(
        res,
        error,
        "Errore nel salvataggio delle risposte"
      );
    }
  };

exports.getQuizHistory =
  async (req, res) => {
    try {
      const userID =
        req.user?.userId;

      if (!userID) {
        return res
          .status(401)
          .json({
            error:
              "UNAUTHORIZED",
          });
      }

      const result =
        await db.query(
          `SELECT
             q.quizid AS "quizID",
             q.title,
             q.description,
             a.attemptid AS "attemptID",
             COALESCE(a.score, 0) AS score,
             COALESCE(a.maxscore, 0) AS "maxScore",
             a.ispassed AS "isPassed",
             a.startedat AS "startedAt",
             a.completedat AS "completedAt",
             COALESCE(
               a.completedat,
               a.startedat
             ) AS "createdAt",
             (a.completedat IS NOT NULL)
               AS "isCompleted"
           FROM attempts a
           INNER JOIN quizzes q
             ON q.quizid = a.quizid
           WHERE a.userid = $1
             AND q.userid = $1
             AND (
               a.completedat IS NOT NULL
               OR EXISTS (
                 SELECT 1
                 FROM answers answer_row
                 WHERE answer_row.attemptid = a.attemptid
               )
             )
           ORDER BY
             COALESCE(
               a.completedat,
               a.startedat
             ) DESC,
             a.attemptid DESC`,
          [userID]
        );

      return res.json(
        result.rows
      );
    } catch (err) {
      console.error(
        "QUIZ HISTORY ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "QUIZ_HISTORY_ERROR",
          message:
            err.message,
        });
    }
  };

exports.getQuizAttemptDetail =
  async (req, res) => {
    try {
      const userID =
        req.user?.userId;

      const quizID =
        positiveId(
          req.params.quizID
        );

      const attemptID =
        positiveId(
          req.params.attemptID
        );

      if (!userID) {
        return res
          .status(401)
          .json({
            error:
              "UNAUTHORIZED",
          });
      }

      const attemptResult =
        await db.query(
          `SELECT
             a.attemptid,
             a.quizid,
             a.score,
             a.maxscore,
             a.startedat,
             a.completedat,
             a.ispassed
           FROM attempts a
           INNER JOIN quizzes q
             ON q.quizid = a.quizid
           WHERE a.attemptid = $1
             AND a.quizid = $2
             AND a.userid = $3
             AND q.userid = $3`,
          [
            attemptID,
            quizID,
            userID,
          ]
        );

      if (
        attemptResult.rows.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            error:
              "Tentativo non trovato",
          });
      }

      const answerResult =
        await db.query(
          `SELECT
             answer_row.questionid,
             question.questiontext,
             question.questiontype,
             question.choicesjson,
             question.correctanswer,
             answer_row.answertext,
             answer_row.iscorrect,
             answer_row.score
           FROM answers answer_row
           INNER JOIN questions question
             ON question.questionid = answer_row.questionid
           WHERE answer_row.attemptid = $1
             AND question.quizid = $2
           ORDER BY question.questionid ASC`,
          [attemptID, quizID]
        );

      const attempt =
        attemptResult.rows[0];

      return res.json({
        attempt,
        details:
          answerResult.rows.map(
            (row) => ({
              questionid:
                row.questionid,
              questiontext:
                row.questiontext,
              answertext:
                row.answertext,
              iscorrect:
                row.iscorrect,
              score:
                row.score,

              questionID:
                row.questionid,
              questionText:
                row.questiontext,
              userAnswer:
                row.answertext,
              correct:
                row.iscorrect,
              correctAnswer:
                attempt.completedat !=
                null
                  ? correctAnswerFor(
                      row
                    )
                  : null,
            })
          ),
      });
    } catch (err) {
      return respondError(
        res,
        err,
        "Errore recupero tentativo"
      );
    }
  };
