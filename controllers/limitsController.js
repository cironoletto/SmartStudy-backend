// controllers/limitsController.js
const db = require("../db");

exports.getLimitsStatus = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "UNAUTHORIZED" });

    const q = await db.query(
      `SELECT feature, count, reset_at
       FROM usage_limits
       WHERE userid = $1
       ORDER BY feature`,
      [userID]
    );

    const now = new Date();
    const rows = q.rows.map((r) => {
      const resetAt = r.reset_at ? new Date(r.reset_at) : null;
      const ms = resetAt ? Math.max(0, resetAt.getTime() - now.getTime()) : 0;

      return {
        feature: r.feature,
        count: Number(r.count) || 0,
        resetAt: r.reset_at,
        secondsToReset: Math.floor(ms / 1000),
      };
    });

    res.json({ now: now.toISOString(), limits: rows });
  } catch (err) {
    console.error("getLimitsStatus ERROR:", err);
    res.status(500).json({ error: "LIMITS_STATUS_ERROR" });
  }
};
