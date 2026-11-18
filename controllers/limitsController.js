const db = require("../db");

const {
  getSubscriptionStatus,
} = require("../services/subscriptionService");

const {
  getUsagePolicy,
} = require("../services/usagePolicy");

function getLimitForFeature(
  feature,
  policy
) {
  switch (feature) {
    case "quiz_sessions":
      return policy.quizDaily;

    case "study_sessions":
      return policy.studyDaily;

    case "oral_evaluations":
      return policy.oralDaily;

    case "quiz_stt":
      return policy.quizSttDaily;

    default:
      return null;
  }
}

exports.getLimitsStatus = async (
  req,
  res
) => {
  try {
    const userID =
      req.user?.userId;

    if (!userID) {
      return res
        .status(401)
        .json({
          error: "UNAUTHORIZED",
        });
    }

    const subscription =
      await getSubscriptionStatus(
        userID
      );

    const policy =
      getUsagePolicy(
        subscription.isPro
      );

    const q =
      await db.query(
        `
        SELECT
          feature,
          count,
          reset_at
        FROM usage_limits
        WHERE userid = $1
        ORDER BY feature
        `,
        [userID]
      );

    const now = new Date();

    const rows =
      q.rows.map((row) => {
        const limit =
          getLimitForFeature(
            row.feature,
            policy
          );

        const resetAt =
          row.reset_at
            ? new Date(
                row.reset_at
              )
            : null;

        const expired =
          resetAt &&
          now >= resetAt;

        const count =
          expired
            ? 0
            : Number(
                row.count
              ) || 0;

        const remaining =
          limit == null
            ? null
            : Math.max(
                0,
                limit - count
              );

        const milliseconds =
          resetAt &&
          !expired
            ? Math.max(
                0,
                resetAt.getTime() -
                  now.getTime()
              )
            : 0;

        return {
          feature:
            row.feature,

          count,

          limit,

          remaining,

          resetAt:
            row.reset_at,

          secondsToReset:
            Math.floor(
              milliseconds /
                1000
            ),
        };
      });

    return res.json({
      now: now.toISOString(),

      isPro:
        subscription.isPro,

      limits: rows,
    });
  } catch (err) {
    console.error(
      "getLimitsStatus ERROR:",
      err
    );

    return res
      .status(500)
      .json({
        error:
          "LIMITS_STATUS_ERROR",
      });
  }
};