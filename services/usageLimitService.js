async function checkLimit(userID, feature, limit) {
  const today = new Date().toISOString().slice(0, 10);

  const q = await db.query(
    `SELECT count, reset_at
     FROM usage_limits
     WHERE userid = $1 AND feature = $2`,
    [userID, feature]
  );

  if (q.rows.length === 0) {
    return { allowed: true, count: 0, remaining: limit };
  }

  const { count, reset_at } = q.rows[0];

  if (reset_at < today) {
    return { allowed: true, count: 0, remaining: limit };
  }

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, count, remaining: limit - count };
}

async function incrementUsage(userID, feature) {
  const today = new Date().toISOString().slice(0, 10);

  await db.query(
    `INSERT INTO usage_limits (userid, feature, count, reset_at)
     VALUES ($1,$2,1,$3)
     ON CONFLICT (userid, feature)
     DO UPDATE SET count = usage_limits.count + 1`,
    [userID, feature, today]
  );
}

module.exports = { checkLimit, incrementUsage };
