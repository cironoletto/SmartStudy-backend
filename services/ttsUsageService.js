// services/ttsUsageService.js
const { pool } = require("../db");

// 🔧 LIMITE GIORNALIERO CONFIGURABILE DA ENV
// Se non impostato, default = 5
const DAILY_LIMIT = Number(process.env.TTS_DAILY_LIMIT || 5);

async function canGenerateTTS(userId) {
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT count FROM user_tts_usage
     WHERE userid = $1 AND day = $2`,
    [userId, today]
  );

  if (rows.length && rows[0].count >= DAILY_LIMIT) {
    return false;
  }

  return true;
}

async function incrementTTS(userId) {
  const today = new Date().toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO user_tts_usage (userid, day, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (userid, day)
     DO UPDATE SET count = user_tts_usage.count + 1`,
    [userId, today]
  );
}

module.exports = {
  canGenerateTTS,
  incrementTTS,
};
