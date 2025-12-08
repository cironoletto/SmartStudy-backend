const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { createUser, getUserByUsername, getUserById } = require("../models/userModel");
const db = require("../db"); // usa db.query per PostgreSQL

const JWT_SECRET = process.env.JWT_SECRET;

/* ------------------------- REGISTER ------------------------- */
async function register(req, res) {
  const { username, password, fullName } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await createUser(username, hashedPassword, fullName);

    res.json({ message: "Utente registrato con successo!" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

/* --------------------------- LOGIN --------------------------- */
async function login(req, res) {
  const { username, password } = req.body;

  try {
    const user = await getUserByUsername(username);

    if (!user)
      return res.status(400).json({ error: "Username o password errati" });

    const match = await bcrypt.compare(password, user.passwordhash);

    if (!match)
      return res.status(400).json({ error: "Username o password errati" });

    const token = jwt.sign({ userId: user.userid }, JWT_SECRET, {
      expiresIn: "8h",
    });

    // Salva nello storico login
    await db.query(
      `INSERT INTO loginhistory (userid, logintime)
       VALUES ($1, NOW())`,
      [user.userid]
    );

    res.json({ message: "Login effettuato!", token });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

/* --------------------------- ME --------------------------- */
async function me(req, res) {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);

    if (!user) return res.status(404).json({ error: "Utente non trovato" });

    res.json({
      userId: user.userid,
      username: user.username,
      fullName: user.fullname,
    });
  } catch (err) {
    console.error("ME ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { register, login, me };
