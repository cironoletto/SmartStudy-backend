const { getSubscriptionStatus } = require("../services/subscriptionService");
const { getUsagePolicy } = require("../services/usagePolicy");

exports.getStatus = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });

    const subscription = await getSubscriptionStatus(userId);
    const policy = getUsagePolicy(subscription.isPro);

    return res.json({
      isPro: subscription.isPro,
      configured: subscription.configured,
      entitlementId: subscription.entitlementId,
      productIdentifier: subscription.productIdentifier || null,
      expiresAt: subscription.expiresAt || null,
      managementUrl: subscription.managementUrl || null,
      limits: policy,
    });
  } catch (err) {
    console.error("SUBSCRIPTION STATUS ERROR:", err);
    return res.status(500).json({ error: "SUBSCRIPTION_STATUS_ERROR" });
  }
};
