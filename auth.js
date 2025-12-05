const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Registrazione
router.post('/register', async (req, res) => {
    const { username, password, fullName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('Username', sql.NVarChar, username)
            .input('PasswordHash', sql.NVarChar, hashedPassword)
            .input('FullName', sql.NVarChar, fullName)
            .query(`INSERT INTO Users (Username, PasswordHash, FullName) 
                    VALUES (@Username, @PasswordHash, @FullName)`);
        res.json({ message: 'Utente registrato con successo!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Username', sql.NVarChar, username)
            .query(`SELECT * FROM Users WHERE Username = @Username`);
        const user = result.recordset[0];
        if (!user) return res.status(400).json({ error: 'Utente non trovato' });

        const match = await bcrypt.compare(password, user.PasswordHash);
        if (!match) return res.status(400).json({ error: 'Password errata' });

        // Creazione token JWT
        const token = jwt.sign({ userId: user.UserID }, JWT_SECRET, { expiresIn: '8h' });

        // Inserimento storico login
        await pool.request()
            .input('UserID', sql.Int, user.UserID)
            .query(`INSERT INTO LoginHistory (UserID, LoginTime) VALUES (@UserID, GETDATE())`);

        res.json({ message: 'Login effettuato!', token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
