const axios = require("axios");

const CACHE_TTL_MS = Number(process.env.REVENUECAT_CACHE_TTL_MS || 60000);
const cache = new Map();

function entitlementIsActive(entitlement) {
  if (!entitlement) return false;

  const now = Date.now();
  const expiresAt = entitlement.expires_date
    ? Date.parse(entitlement.expires_date)
    : null;
  const graceAt = entitlement.grace_period_expires_date
    ? Date.parse(entitlement.grace_period_expires_date)
    : null;

  // Lifetime / non-expiring entitlement.
  if (!expiresAt) return true;
  if (expiresAt > now) return true;
  if (graceAt && graceAt > now) return true;

  return false;
}

async function getSubscriptionStatus(userId) {
  const appUserId = String(userId);
  const entitlementId =
    process.env.REVENUECAT_ENTITLEMENT_ID || "SmartStudyMobile Pro";
  const secretKey = process.env.REVENUECAT_SECRET_API_KEY;

  if (!secretKey) {
    return {
      isPro: false,
      configured: false,
      appUserId,
      entitlementId,
      managementUrl: null,
    };
  }

  const cached = cache.get(appUserId);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: "application/json",
        },
        timeout: 8000,
      }
    );

    const subscriber = response.data?.subscriber || {};
    const entitlement = subscriber.entitlements?.[entitlementId] || null;

    const value = {
      isPro: entitlementIsActive(entitlement),
      configured: true,
      appUserId,
      entitlementId,
      productIdentifier: entitlement?.product_identifier || null,
      expiresAt: entitlement?.expires_date || null,
      managementUrl: subscriber.management_url || null,
    };

    cache.set(appUserId, { savedAt: Date.now(), value });
    return value;
  } catch (error) {
    console.error(
      "RevenueCat status error:",
      error.response?.status || error.message
    );

    // If RevenueCat is temporarily unavailable, reuse a recent cached status.
    if (cached) return cached.value;

    // Fail closed to protect paid API costs.
    return {
      isPro: false,
      configured: true,
      appUserId,
      entitlementId,
      managementUrl: null,
      unavailable: true,
    };
  }
}

async function hasProAccess(userId) {
  const status = await getSubscriptionStatus(userId);
  return status.isPro;
}

module.exports = {
  getSubscriptionStatus,
  hasProAccess,
};
