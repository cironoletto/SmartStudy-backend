const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { createUser, getUserByUsername, getUserById } = require('../models/userModel');
const { getConnection, sql } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

// ------------------ REGISTER ------------------
async function register(req, res) {
    const { username, password, fullName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        await createUser(username, hashedPassword, fullName);
        res.json({ message: 'Utente registrato con successo!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ------------------ LOGIN ------------------
async function login(req, res) {
    const { username, password } = req.body;

    try {
        const user = await getUserByUsername(username);
        if (!user) return res.status(400).json({ error: 'Username o password errati' });

        const match = await bcrypt.compare(password, user.PasswordHash);
        if (!match) return res.status(400).json({ error: 'Username o password errati' });

        const token = jwt.sign({ userId: user.UserID }, JWT_SECRET, { expiresIn: '8h' });

        // ⭐ OTTIENI LA CONNESSIONE DAL db.js
        console.log("➡️ Tentativo connessione SQL...");
const pool = await getConnection();
console.log("POOL RICEVUTO:", pool);
console.log("TIPO:", typeof pool);
console.log("CHIAVI POOL:", pool ? Object.keys(pool) : "pool = undefined");


        // Salva storico login
        await pool.request()
            .input('UserID', sql.Int, user.UserID)
            .query(`
                INSERT INTO LoginHistory (UserID, LoginTime)
                VALUES (@UserID, GETDATE())
            `);

        res.json({ message: 'Login effettuato!', token });

    } catch (err) {
        console.error("LOGIN ERROR:", err);
        res.status(500).json({ error: err.message });
    }
}

// ------------------ ME ------------------
async function me(req, res) {
    try {
        const userId = req.user.userId;
        const user = await getUserById(userId);

        if (!user) return res.status(404).json({ error: "Utente non trovato" });

        res.json({
            userId: user.UserID,
            username: user.Username,
            fullName: user.FullName
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = { register, login, me };
