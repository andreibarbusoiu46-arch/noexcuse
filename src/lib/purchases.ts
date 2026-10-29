// RevenueCat on the device. The client uses it to decide which screen to show;
// the server re-checks the entitlement itself before anything that matters (proofs, scoring).
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { config } from './config';

let configured = false;

export function purchasesAvailable(): boolean {
  return !config.demo && Boolean(config.revenueCatKey) && Platform.OS !== 'web';
}

export async function identifyPurchaser(userId: string): Promise<void> {
  if (!purchasesAvailable()) return;
  if (!configured) {
    Purchases.configure({ apiKey: config.revenueCatKey, appUserID: userId });
    configured = true;
    return;
  }
  const current = await Purchases.getAppUserID().catch(() => null);
  if (current !== userId) await Purchases.logIn(userId);
}

export async function forgetPurchaser(): Promise<void> {
  if (!purchasesAvailable() || !configured) return;
  await Purchases.logOut().catch(() => {});
}

export const hasPremium = (info: CustomerInfo | null | undefined): boolean =>
  Boolean(info?.entitlements.active[config.entitlementId]);

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!purchasesAvailable() || !configured) return null;
  return Purchases.getCustomerInfo();
}

export function onCustomerInfo(cb: (info: CustomerInfo) => void): () => void {
  if (!purchasesAvailable() || !configured) return () => {};
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}

export interface Plan {
  pkg: PurchasesPackage | null; // null only in demo mode
  priceString: string; // localized, from the store
  period: string; // "month"
  trialDays: number | null; // only when the user is eligible right now
}

/** The paywall can show a plan: real store plan, or the fixture plan in demo mode. */
export const paywallAvailable = (): boolean => purchasesAvailable() || config.demo;

/** Loads the "default" offering's monthly package and whether this user can still get the free trial. */
export async function loadPlan(): Promise<Plan | null> {
  if (config.demo) return { pkg: null, priceString: '€9.99', period: 'month', trialDays: 3 };
  if (!purchasesAvailable() || !configured) return null;
  const offerings = await Purchases.getOfferings();
  const offering = offerings.all[config.offeringId] ?? offerings.current;
  const pkg = offering?.monthly ?? offering?.availablePackages[0];
  if (!pkg) return null;
  const product = pkg.product;
  let trialDays: number | null = null;
  const intro = product.introPrice;
  if (intro && intro.price === 0) {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility([product.identifier]).catch(() => null);
    const status = eligibility?.[product.identifier]?.status;
    if (status === Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) {
      const unit = intro.periodUnit.toUpperCase();
      trialDays = unit.startsWith('DAY') ? intro.periodNumberOfUnits : unit.startsWith('WEEK') ? intro.periodNumberOfUnits * 7 : null;
    }
  }
  return { pkg, priceString: product.priceString, period: 'month', trialDays };
}

export type PurchaseResult = { ok: true; premium: boolean } | { ok: false; cancelled: boolean; message: string };

export async function buy(plan: Plan): Promise<PurchaseResult> {
  if (config.demo) return { ok: true, premium: true };
  if (!plan.pkg) return { ok: false, cancelled: false, message: 'No plan available.' };
  try {
    const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
    return { ok: true, premium: hasPremium(customerInfo) };
  } catch (e) {
    const err = e as { code?: string; userCancelled?: boolean; message?: string };
    const cancelled = err.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || err.userCancelled === true;
    return { ok: false, cancelled, message: cancelled ? '' : err.message ?? 'The purchase didn’t go through.' };
  }
}

export async function restore(): Promise<PurchaseResult> {
  if (config.demo) return { ok: true, premium: true };
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, premium: hasPremium(info) };
  } catch (e) {
    return { ok: false, cancelled: false, message: (e as Error).message ?? 'Restore failed.' };
  }
}

export async function manageSubscription(): Promise<void> {
  if (!purchasesAvailable()) return;
  await Purchases.showManageSubscriptions();
}
