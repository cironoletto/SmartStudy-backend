require("dotenv").config();
const sql = require("mssql");
const { Pool } = require("pg");

// -----------------------------------------------
// SQL SERVER CONFIG
// -----------------------------------------------
const sqlConfig = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_HOST,
  database: process.env.SQLSERVER_DATABASE,
  port: parseInt(process.env.SQLSERVER_PORT || 1433),
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// -----------------------------------------------
// POSTGRES CONFIG
// -----------------------------------------------
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// -----------------------------------------------
// CREATE TABLES IN POSTGRES
// -----------------------------------------------
const createTables = async () => {
  console.log("🛠️ Creazione tabelle PostgreSQL...");
  await pgPool.query(`

    CREATE TABLE IF NOT EXISTS users (
      userid INT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      passwordhash VARCHAR(255) NOT NULL,
      fullname VARCHAR(100),
      email VARCHAR(100),
      createdat TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      quizid INT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      description VARCHAR(500),
      createdat TIMESTAMP,
      userid INT REFERENCES users(userid)
    );

    CREATE TABLE IF NOT EXISTS quiz (
      quizid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      createdat TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS questions (
      questionid INT PRIMARY KEY,
      quizid INT REFERENCES quizzes(quizid),
      questiontext TEXT NOT NULL,
      imagepath VARCHAR(500),
      questiontype VARCHAR(50),
      choicesjson TEXT,
      correctanswer TEXT,
      points INT
    );

    CREATE TABLE IF NOT EXISTS attempts (
      attemptid INT PRIMARY KEY,
      quizid INT REFERENCES quizzes(quizid),
      userid INT REFERENCES users(userid),
      startedat TIMESTAMP,
      completedat TIMESTAMP,
      score INT,
      maxscore INT,
      ispassed BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS answers (
      answerid INT PRIMARY KEY,
      questionid INT REFERENCES questions(questionid),
      answertext TEXT NOT NULL,
      iscorrect BOOLEAN,
      attemptid INT,
      score INT
    );

    CREATE TABLE IF NOT EXISTS loginhistory (
      loginid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      logintime TIMESTAMP,
      logouttime TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notesimages (
      imageid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      imagepath VARCHAR(500) NOT NULL,
      uploadedat TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quizresults (
      resultid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      quizid INT REFERENCES quizzes(quizid),
      score NUMERIC(5,2),
      completed BOOLEAN,
      startedat TIMESTAMP,
      completedat TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS questionprogress (
      progressid INT PRIMARY KEY,
      resultid INT REFERENCES quizresults(resultid),
      questionid INT REFERENCES questions(questionid),
      useranswerid INT REFERENCES answers(answerid),
      correct BOOLEAN
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      sessionid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      createdat TIMESTAMP,
      subject VARCHAR(120),
      type VARCHAR(100),
      rawtext TEXT NOT NULL,
      rating INT
    );

    CREATE TABLE IF NOT EXISTS study_summaries (
      summaryid INT PRIMARY KEY,
      sessionid INT REFERENCES study_sessions(sessionid),
      summary TEXT NOT NULL,
      ailevel VARCHAR(50),
      audiourl VARCHAR(300)
    );

    CREATE TABLE IF NOT EXISTS study_problems (
      problemid INT PRIMARY KEY,
      sessionid INT REFERENCES study_sessions(sessionid),
      detectedtype VARCHAR(20),
      problemtext TEXT NOT NULL,
      solutionsteps TEXT NOT NULL,
      finalanswer VARCHAR(255)
    );

    CREATE TABLE IF NOT EXISTS study_oral_evaluations (
      oralid INT PRIMARY KEY,
      sessionid INT REFERENCES study_sessions(sessionid),
      aisummary TEXT NOT NULL,
      useraudiourl VARCHAR(500),
      aifeedback TEXT,
      score INT,
      createdat TIMESTAMP,
      transcript TEXT,
      userid INT REFERENCES users(userid)
    );

    CREATE TABLE IF NOT EXISTS sent_items (
      sentid INT PRIMARY KEY,
      userid INT REFERENCES users(userid),
      sessionid INT REFERENCES study_sessions(sessionid),
      senttype VARCHAR(20),
      destination VARCHAR(255),
      createdat TIMESTAMP
    );

  `);

  console.log("✔️ Tabelle create!");
};

// ------------------------------------------------------
// GENERIC MIGRATION FUNCTION
// ------------------------------------------------------
const migrateTable = async (table, insertSQL, mapRow) => {
  console.log(`📦 Migrating: ${table}...`);

  const mssqlRows = (await sql.query(`SELECT * FROM ${table}`)).recordset;

  for (const row of mssqlRows) {
    await pgPool.query(insertSQL, mapRow(row));
  }

  console.log(`✔️ Completed: ${table} (${mssqlRows.length} rows)`);
};

// ------------------------------------------------------
// MIGRATION PIPELINE
// ------------------------------------------------------
const runMigration = async () => {
  console.log("🚀 Avvio migrazione...");

  await sql.connect(sqlConfig);
  console.log("✔️ Connesso a SQL Server");

  await createTables();

  // MIGRAZIONE (ordine rispettato!)
  await migrateTable("Users",
    "INSERT INTO users (userid, username, passwordhash, fullname, email, createdat) VALUES ($1,$2,$3,$4,$5,$6)",
    r => [r.UserID, r.Username, r.PasswordHash, r.FullName, r.Email, r.CreatedAt]
  );

  await migrateTable("Quizzes",
    "INSERT INTO quizzes (quizid, title, description, createdat, userid) VALUES ($1,$2,$3,$4,$5)",
    r => [r.QuizID, r.Title, r.Description, r.CreatedAt, r.UserID]
  );

  await migrateTable("Quiz",
    "INSERT INTO quiz (quizid, userid, title, description, createdat) VALUES ($1,$2,$3,$4,$5)",
    r => [r.QuizID, r.UserID, r.Title, r.Description, r.CreatedAt]
  );

  await migrateTable("Questions",
    "INSERT INTO questions (questionid, quizid, questiontext, imagepath, questiontype, choicesjson, correctanswer, points) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    r => [r.QuestionID, r.QuizID, r.QuestionText, r.ImagePath, r.QuestionType, r.ChoicesJSON, r.CorrectAnswer, r.Points]
  );

  await migrateTable("Attempts",
    "INSERT INTO attempts (attemptid, quizid, userid, startedat, completedat, score, maxscore, ispassed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    r => [r.AttemptID, r.QuizID, r.UserID, r.StartedAt, r.CompletedAt, r.Score, r.MaxScore, r.IsPassed]
  );

  await migrateTable("Answers",
    "INSERT INTO answers (answerid, questionid, answertext, iscorrect, attemptid, score) VALUES ($1,$2,$3,$4,$5,$6)",
    r => [r.AnswerID, r.QuestionID, r.AnswerText, r.IsCorrect, r.AttemptID, r.Score]
  );

  await migrateTable("LoginHistory",
    "INSERT INTO loginhistory (loginid, userid, logintime, logouttime) VALUES ($1,$2,$3,$4)",
    r => [r.LoginID, r.UserID, r.LoginTime, r.LogoutTime]
  );

  await migrateTable("NotesImages",
    "INSERT INTO notesimages (imageid, userid, imagepath, uploadedat) VALUES ($1,$2,$3,$4)",
    r => [r.ImageID, r.UserID, r.ImagePath, r.UploadedAt]
  );

  await migrateTable("QuizResults",
    "INSERT INTO quizresults (resultid, userid, quizid, score, completed, startedat, completedat) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    r => [r.ResultID, r.UserID, r.QuizID, r.Score, r.Completed, r.StartedAt, r.CompletedAt]
  );

  await migrateTable("QuestionProgress",
    "INSERT INTO questionprogress (progressid, resultid, questionid, useranswerid, correct) VALUES ($1,$2,$3,$4,$5)",
    r => [r.ProgressID, r.ResultID, r.QuestionID, r.UserAnswerID, r.Correct]
  );

  await migrateTable("study_sessions",
    "INSERT INTO study_sessions (sessionid, userid, createdat, subject, type, rawtext, rating) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    r => [r.sessionID, r.userID, r.createdAt, r.subject, r.type, r.rawText, r.rating]
  );

  await migrateTable("study_summaries",
    "INSERT INTO study_summaries (summaryid, sessionid, summary, ailevel, audiourl) VALUES ($1,$2,$3,$4,$5)",
    r => [r.summaryID, r.sessionID, r.summary, r.aiLevel, r.audioUrl]
  );

  await migrateTable("study_problems",
    "INSERT INTO study_problems (problemid, sessionid, detectedtype, problemtext, solutionsteps, finalanswer) VALUES ($1,$2,$3,$4,$5,$6)",
    r => [r.problemID, r.sessionID, r.detectedType, r.problemText, r.solutionSteps, r.finalAnswer]
  );

  await migrateTable("study_oral_evaluations",
    "INSERT INTO study_oral_evaluations (oralid, sessionid, aisummary, useraudiourl, aifeedback, score, createdat, transcript, userid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    r => [r.oralID, r.sessionID, r.aiSummary, r.userAudioURL, r.aiFeedback, r.score, r.createdAt, r.transcript, r.userID]
  );

  await migrateTable("sent_items",
    "INSERT INTO sent_items (sentid, userid, sessionid, senttype, destination, createdat) VALUES ($1,$2,$3,$4,$5,$6)",
    r => [r.sentID, r.userID, r.sessionID, r.sentType, r.destination, r.createdAt]
  );

  console.log("🎉 MIGRAZIONE COMPLETATA!");
  process.exit(0);
};

runMigration();
