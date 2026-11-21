const db = require("../db");
const { getSubscriptionStatus } = require("../services/subscriptionService");

module.exports = async function studyAccess(req, res, next) {
  try {
    const id = req.user.userId;
    const { rows } = await db.query(
      "SELECT free_trial_ends_at > CURRENT_TIMESTAMP AS active FROM users WHERE userid = $1",
      [id]
    );
    if (!rows.length) return res.status(401).json({ error: "TOKEN_INVALID" });
    if (rows[0].active) return next();

    const plan = await getSubscriptionStatus(id, { recheckFree: true });
    if (plan.isPro) return next();
    if (!plan.configured || plan.unavailable) {
      return res.status(503).json({ error: "SUBSCRIPTION_UNAVAILABLE",
        message: "Verifica abbonamento temporaneamente non disponibile." });
    }
    return res.status(403).json({ error: "FREE_TRIAL_EXPIRED",
      message: "La settimana gratuita è terminata. Attiva Premium per continuare." });
  } catch (err) {
    return next(err);
  }
};
