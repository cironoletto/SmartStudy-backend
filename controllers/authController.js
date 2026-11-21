const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const {
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  updateUserEmail,
  updatePasswordHash,
} = require("../models/userModel");
const db = require("../db");
const emailService = require("../services/emailService");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const RESET_EXPIRES_MINUTES = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 15);
const RESET_MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || 5);
const RESET_REQUEST_COOLDOWN_SECONDS = Number(
  process.env.PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS || 60
);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resetSecret() {
  return process.env.PASSWORD_RESET_SECRET || JWT_SECRET;
}

function hashResetCode(userId, code) {
  const secret = resetSecret();
  if (!secret) throw new Error("PASSWORD_RESET_SECRET_MISSING");

  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${code}`)
    .digest("hex");
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/* ------------------------- REGISTER ------------------------- */
async function register(req, res) {
  const username = cleanText(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const fullName = cleanText(req.body?.fullName).replace(/\s+/g, " ");
  const email = normalizeEmail(req.body?.email);

  if (!username) {
    return res.status(400).json({ error: "USERNAME_REQUIRED", message: "Username obbligatorio" });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({
      error: "PASSWORD_INVALID",
      message: "La password deve contenere almeno 8 caratteri",
    });
  }

  if (!fullName || fullName.split(" ").length < 2) {
    return res.status(400).json({
      error: "FULL_NAME_REQUIRED",
      message: "Nome e cognome sono obbligatori",
    });
  }

  if (email && !isValidEmail(email)) {
    return res.status(400).json({
      error: "EMAIL_INVALID",
      message: "Inserisci un indirizzo email valido",
    });
  }

  try {
    const existingUsername = await getUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        error: "USERNAME_EXISTS",
        message: "Questo username è già registrato. Scegline un altro.",
      });
    }

    if (email) {
      const existingEmail = await getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({
          error: "EMAIL_EXISTS",
          message: "Questa email è già associata a un account.",
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await createUser(username, hashedPassword, fullName, email);

    return res.status(201).json({
      message: "Utente registrato con successo!",
      user: {
        userId: user.userid,
        username: user.username,
        fullName: user.fullname,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: "ACCOUNT_EXISTS",
        message: "Username o email già registrati.",
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
    if (!user) return res.status(400).json({ error: "Username o password errati" });

    const match = await bcrypt.compare(password, user.passwordhash);
    if (!match) return res.status(400).json({ error: "Username o password errati" });

    const token = jwt.sign(
  {
    userId: user.userid,
  },
  JWT_SECRET,
  {
    expiresIn:
      JWT_EXPIRES_IN,
  }
);

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
        email: user.email || null,
      freeTrialEndsAt: user.free_trial_ends_at,
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
      email: user.email || null,
      freeTrialEndsAt: user.free_trial_ends_at,
    });
  } catch (err) {
    console.error("ME ERROR:", err);
    return res.status(500).json({ error: "Errore recupero profilo" });
  }
}

/* ------------------------- SET EMAIL ------------------------- */
async function setEmail(req, res) {
  try {
    const userId = req.user?.userId;
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "EMAIL_INVALID", message: "Email non valida" });
    }

    if (!password) {
      return res.status(400).json({
        error: "PASSWORD_REQUIRED",
        message: "Inserisci la password corrente",
      });
    }

    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const passwordOk = await bcrypt.compare(password, user.passwordhash);
    if (!passwordOk) {
      return res.status(400).json({
        error: "PASSWORD_INVALID",
        message: "Password corrente non corretta",
      });
    }

    const existing = await getUserByEmail(email);
    if (existing && Number(existing.userid) !== Number(userId)) {
      return res.status(409).json({
        error: "EMAIL_EXISTS",
        message: "Questa email è già associata a un altro account",
      });
    }

    const updated = await updateUserEmail(userId, email);
    return res.json({
      ok: true,
      user: {
        userId: updated.userid,
        username: updated.username,
        fullName: updated.fullname,
        email: updated.email,
      },
    });
  } catch (err) {
    console.error("SET EMAIL ERROR:", err);
    return res.status(500).json({ error: "EMAIL_UPDATE_FAILED" });
  }
}

/* -------------------- FORGOT PASSWORD -------------------- */
async function forgotPassword(req, res) {
  const email = normalizeEmail(req.body?.email);
  const genericResponse = {
    ok: true,
    message: "Se l'email è associata a un account SmartStudy, riceverai un codice di recupero.",
  };

  if (!isValidEmail(email)) {
    return res.status(200).json(genericResponse);
  }

  if (!emailService.isConfigured()) {
    console.error("FORGOT PASSWORD: SMTP non configurato");
    return res.status(503).json({
      error: "EMAIL_SERVICE_UNAVAILABLE",
      message: "Servizio email temporaneamente non disponibile",
    });
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(200).json(genericResponse);

    const recent = await db.query(
      `SELECT createdat
       FROM password_reset_codes
       WHERE userid = $1
       ORDER BY createdat DESC
       LIMIT 1`,
      [user.userid]
    );

    if (recent.rows.length) {
      const ageSeconds = (Date.now() - new Date(recent.rows[0].createdat).getTime()) / 1000;
      if (ageSeconds < RESET_REQUEST_COOLDOWN_SECONDS) {
        return res.status(200).json(genericResponse);
      }
    }

    await db.query(
      `UPDATE password_reset_codes
       SET usedat = COALESCE(usedat, NOW())
       WHERE userid = $1 AND usedat IS NULL`,
      [user.userid]
    );

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = hashResetCode(user.userid, code);

    await db.query(
      `INSERT INTO password_reset_codes
         (userid, codehash, expiresat, attemptcount, createdat)
       VALUES
         ($1, $2, NOW() + ($3 * INTERVAL '1 minute'), 0, NOW())`,
      [user.userid, codeHash, RESET_EXPIRES_MINUTES]
    );

    await emailService.sendPasswordResetCode({
      to: user.email,
      fullName: user.fullname,
      code,
      expiresMinutes: RESET_EXPIRES_MINUTES,
    });

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return res.status(500).json({
      error: "PASSWORD_RESET_REQUEST_FAILED",
      message: "Impossibile inviare il codice di recupero",
    });
  }
}

/* -------------------- RESET PASSWORD -------------------- */
async function resetPassword(req, res) {
  const email = normalizeEmail(req.body?.email);
  const code = cleanText(req.body?.code);
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: "RESET_DATA_INVALID",
      message: "Email o codice non validi",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      error: "PASSWORD_INVALID",
      message: "La nuova password deve contenere almeno 8 caratteri",
    });
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT userid, email
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (!userResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "RESET_CODE_INVALID",
        message: "Codice non valido o scaduto",
      });
    }

    const userId = userResult.rows[0].userid;

    const resetResult = await client.query(
      `SELECT resetid, codehash, expiresat, attemptcount
       FROM password_reset_codes
       WHERE userid = $1
         AND usedat IS NULL
         AND expiresat > NOW()
       ORDER BY createdat DESC
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (!resetResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "RESET_CODE_INVALID",
        message: "Codice non valido o scaduto",
      });
    }

    const reset = resetResult.rows[0];

    if (Number(reset.attemptcount) >= RESET_MAX_ATTEMPTS) {
      await client.query(
        `UPDATE password_reset_codes SET usedat = NOW() WHERE resetid = $1`,
        [reset.resetid]
      );
      await client.query("COMMIT");
      return res.status(400).json({
        error: "RESET_CODE_INVALID",
        message: "Codice non valido o scaduto",
      });
    }

    const providedHash = hashResetCode(userId, code);
    const matches = safeEqualHex(providedHash, reset.codehash);

    if (!matches) {
      await client.query(
        `UPDATE password_reset_codes
         SET attemptcount = attemptcount + 1
         WHERE resetid = $1`,
        [reset.resetid]
      );
      await client.query("COMMIT");
      return res.status(400).json({
        error: "RESET_CODE_INVALID",
        message: "Codice non valido o scaduto",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await updatePasswordHash(client, userId, passwordHash);

    await client.query(
      `UPDATE password_reset_codes
       SET usedat = NOW()
       WHERE resetid = $1`,
      [reset.resetid]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Password aggiornata correttamente. Ora puoi accedere.",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({
      error: "PASSWORD_RESET_FAILED",
      message: "Impossibile aggiornare la password",
    });
  } finally {
    client.release();
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

    await client.query(`DELETE FROM study_oral_evaluations WHERE userid = $1`, [userId]);
    await client.query(
      `DELETE FROM study_summaries
       WHERE sessionid IN (SELECT sessionid FROM study_sessions WHERE userid = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM study_sessions WHERE userid = $1`, [userId]);

    await client.query(`DELETE FROM usage_limits WHERE userid = $1`, [userId]);
    await client.query(`DELETE FROM user_tts_usage WHERE userid = $1`, [userId]);
    await client.query(`DELETE FROM loginhistory WHERE userid = $1`, [userId]);
    await client.query(`DELETE FROM password_reset_codes WHERE userid = $1`, [userId]);

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

module.exports = {
  register,
  login,
  me,
  setEmail,
  forgotPassword,
  resetPassword,
  deleteAccount,
};
