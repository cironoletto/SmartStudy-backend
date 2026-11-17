const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const {
  createUser,
  getUserByUsername,
  getUserById,
} = require("../models/userModel");
const db = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------- REGISTER ------------------------- */
async function register(req, res) {
  const username = cleanText(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const fullName = cleanText(req.body?.fullName).replace(/\s+/g, " ");

  if (!username) {
    return res.status(400).json({
      error: "USERNAME_REQUIRED",
      message: "Username obbligatorio",
    });
  }

  if (!password) {
    return res.status(400).json({
      error: "PASSWORD_REQUIRED",
      message: "Password obbligatoria",
    });
  }

  if (!fullName || fullName.split(" ").length < 2) {
    return res.status(400).json({
      error: "FULL_NAME_REQUIRED",
      message: "Nome e cognome sono obbligatori",
    });
  }

  try {
    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(409).json({
        error: "USERNAME_EXISTS",
        message: "Questo username e gia registrato. Scegline un altro.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await createUser(username, hashedPassword, fullName);

    return res.status(201).json({
      message: "Utente registrato con successo!",
      user: {
        userId: user.userid,
        username: user.username,
        fullName: user.fullname,
      },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);

    // PostgreSQL unique_violation: handles also a race between two registrations.
    if (err.code === "23505") {
      return res.status(409).json({
        error: "USERNAME_EXISTS",
        message: "Questo username e gia registrato. Scegline un altro.",
      });
    }

    return res.status(500).json({
      error: "REGISTER_FAILED",
      message: "Impossibile completare la registrazione",
    });
  }
}

/* --------------------------- LOGIN --------------------------- */
async function login(req, res) {
  try {
    const username = cleanText(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!username || !password) {
      return res.status(400).json({ error: "Username o password errati" });
    }

    const user = await getUserByUsername(username);

    if (!user) {
      return res.status(400).json({ error: "Username o password errati" });
    }

    const match = await bcrypt.compare(password, user.passwordhash);
    if (!match) {
      return res.status(400).json({ error: "Username o password errati" });
    }

    const token = jwt.sign({ userId: user.userid }, JWT_SECRET, {
      expiresIn: "8h",
    });

    await db.query(
      `INSERT INTO loginhistory (userid, logintime)
       VALUES ($1, NOW())`,
      [user.userid]
    );

    return res.json({
      message: "Login effettuato!",
      token,
      user: {
        userId: user.userid,
        username: user.username,
        fullName: user.fullname,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Errore durante il login" });
  }
}

/* --------------------------- ME --------------------------- */
async function me(req, res) {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);

    if (!user) return res.status(404).json({ error: "Utente non trovato" });

    return res.json({
      userId: user.userid,
      username: user.username,
      fullName: user.fullname,
    });
  } catch (err) {
    console.error("ME ERROR:", err);
    return res.status(500).json({ error: "Errore recupero profilo" });
  }
}

/* ---------------------- DELETE ACCOUNT ---------------------- */
async function deleteAccount(req, res) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });

  if (req.body?.confirm !== true) {
    return res.status(400).json({
      error: "CONFIRMATION_REQUIRED",
      message: "Conferma esplicitamente la cancellazione dell'account.",
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // Quiz data
    await client.query(
      `DELETE FROM answers
       WHERE attemptid IN (SELECT attemptid FROM attempts WHERE userid = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM attempts WHERE userid = $1`, [userId]);
    await client.query(
      `DELETE FROM questions
       WHERE quizid IN (SELECT quizid FROM quizzes WHERE userid = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM quizzes WHERE userid = $1`, [userId]);

    // Study data
    await client.query(`DELETE FROM study_oral_evaluations WHERE userid = $1`, [userId]);
    await client.query(
      `DELETE FROM study_summaries
       WHERE sessionid IN (SELECT sessionid FROM study_sessions WHERE userid = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM study_sessions WHERE userid = $1`, [userId]);

    // Usage and login data
    await client.query(`DELETE FROM usage_limits WHERE userid = $1`, [userId]);
    await client.query(`DELETE FROM user_tts_usage WHERE userid = $1`, [userId]);
    await client.query(`DELETE FROM loginhistory WHERE userid = $1`, [userId]);

    const deleted = await client.query(
      `DELETE FROM users WHERE userid = $1 RETURNING userid`,
      [userId]
    );

    if (!deleted.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utente non trovato" });
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("DELETE ACCOUNT ERROR:", err);
    return res.status(500).json({
      error: "DELETE_ACCOUNT_FAILED",
      message: "Impossibile cancellare l'account",
    });
  } finally {
    client.release();
  }
}

module.exports = { register, login, me, deleteAccount };
