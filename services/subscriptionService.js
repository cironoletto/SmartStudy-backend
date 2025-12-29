import Purchases from "react-native-purchases";

export async function hasProAccess() {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return !!customerInfo.entitlements.active["SmartStudyMobile Pro"];
  } catch (e) {
    console.warn("❌ Entitlement check failed:", e);
    return false;
  }
}
