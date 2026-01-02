const db = require("../db");

/**
 * ✅ CHECK SENZA INCREMENTARE
 * Usato PRIMA di elaborare (preview / OCR / AI)
 */
async function checkLimit(userID, feature, limit) {
  const today = new Date().toISOString().slice(0, 10);

  const q = await db.query(
    `SELECT count, reset_at
     FROM usage_limits
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );

  // Prima volta → tutto disponibile
  if (q.rows.length === 0) {
    return {
      allowed: limit > 0,
      remaining: limit,
    };
  }

  const { count, reset_at } = q.rows[0];

  // Nuovo giorno → reset virtuale
  if (reset_at < today) {
    return {
      allowed: limit > 0,
      remaining: limit,
    };
  }

  // Limite raggiunto
  if (count >= limit) {
    return {
      allowed: false,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    remaining: limit - count,
  };
}

/**
 * ✅ INCREMENTO REALE
 * Usato SOLO dopo successo (AI / OCR completato)
 */
async function incrementUsage(userID, feature) {
  const today = new Date().toISOString().slice(0, 10);

  const q = await db.query(
    `SELECT count, reset_at
     FROM usage_limits
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );

  // Prima volta → crea riga
  if (q.rows.length === 0) {
    await db.query(
      `INSERT INTO usage_limits (userid, feature, count, reset_at)
       VALUES ($1, $2, 1, $3)`,
      [userID, feature, today]
    );
    return;
  }

  const { reset_at } = q.rows[0];

  // Nuovo giorno → reset + 1
  if (reset_at < today) {
    await db.query(
      `UPDATE usage_limits
       SET count = 1, reset_at = $3
       WHERE userid = $1 AND feature = $2`,
      [userID, feature, today]
    );
    return;
  }

  // Incremento normale
  await db.query(
    `UPDATE usage_limits
     SET count = count + 1
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );
}

module.exports = {
  checkLimit,
  incrementUsage,
};

