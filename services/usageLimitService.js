const db = require("../db");

/**
 * Controlla se l'utente può usare una feature
 * Se non esiste la riga → la crea
 * Reset automatico giornaliero
 */
async function checkAndIncrement(userID, feature, limit) {
  const today = new Date().toISOString().slice(0, 10);

  const q = await db.query(
    `SELECT count, reset_at
     FROM usage_limits
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );

  // 🆕 prima volta
  if (q.rows.length === 0) {
    if (limit === 0) {
      return { allowed: false, remaining: 0 };
    }

    await db.query(
      `INSERT INTO usage_limits (userid, feature, count, reset_at)
       VALUES ($1, $2, 1, $3)`,
      [userID, feature, today]
    );

    return { allowed: true, remaining: limit - 1 };
  }

  const { count, reset_at } = q.rows[0];

  // 🔄 nuovo giorno → reset
  if (reset_at < today) {
    await db.query(
      `UPDATE usage_limits
       SET count = 1, reset_at = $3
       WHERE userid = $1 AND feature = $2`,
      [userID, feature, today]
    );

    return { allowed: true, remaining: limit - 1 };
  }

  // 🚫 limite raggiunto
  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  // ➕ incrementa
  await db.query(
    `UPDATE usage_limits
     SET count = count + 1
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );

  return { allowed: true, remaining: limit - count - 1 };
}

module.exports = { checkAndIncrement };
