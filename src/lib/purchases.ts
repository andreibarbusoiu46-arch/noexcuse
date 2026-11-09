// RevenueCat on the device. The client uses it to decide which screen to show;
// the server re-checks the entitlement itself before anything that matters (proofs, scoring).
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesPackage } from 'react-native-purchases';
import { config } from './config';
import { ApiError, callFunction, supabase } from './supabase';

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

/** Web subscriptions go through Stripe Checkout (the App Store build must use In-App Purchase instead). */
export const stripeAvailable = (): boolean => !config.demo && Platform.OS === 'web';

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
  /** Web (Stripe) plans: 'test' while Stripe is in test mode — no real money moves. */
  stripeMode?: 'test' | 'live';
}

/** The paywall can show a plan: real store plan, or the fixture plan in demo mode. */
export const paywallAvailable = (): boolean => purchasesAvailable() || stripeAvailable() || config.demo;

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

async function loadStripePlan(): Promise<Plan | null> {
  try {
    const r = await callFunction<{ amount: number; currency: string; interval: string; trial_days: number | null; mode: 'test' | 'live' }>('billing', { action: 'plan' });
    return { pkg: null, priceString: money(r.amount, r.currency), period: r.interval, trialDays: r.trial_days, stripeMode: r.mode };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'billing_not_configured') return null;
    throw e;
  }
}

/** Loads the "default" offering's monthly package and whether this user can still get the free trial. */
export async function loadPlan(): Promise<Plan | null> {
  if (config.demo) return { pkg: null, priceString: '€9.99', period: 'month', trialDays: 3 };
  if (stripeAvailable()) return loadStripePlan();
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
  if (stripeAvailable()) {
    // Stripe Checkout is a hosted page: leave the app; Stripe sends the user back to /billing.
    try {
      const r = await callFunction<{ url: string }>('billing', { action: 'checkout' });
      window.location.assign(r.url);
      return { ok: false, cancelled: true, message: '' };
    } catch (e) {
      return { ok: false, cancelled: false, message: e instanceof Error ? e.message : '' };
    }
  }
  if (!plan.pkg) return { ok: false, cancelled: false, message: '' }; // callers show their own translated fallback
  try {
    const { customerInfo } = await Purchases.purchasePackage(plan.pkg);
    return { ok: true, premium: hasPremium(customerInfo) };
  } catch (e) {
    const err = e as { code?: string; userCancelled?: boolean; message?: string };
    const cancelled = err.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || err.userCancelled === true;
    return { ok: false, cancelled, message: cancelled ? '' : err.message ?? '' };
  }
}

/** Re-reads the web subscription from Stripe and returns whether the server now grants Premium. */
export async function syncStripe(): Promise<boolean> {
  await callFunction('billing', { action: 'sync' });
  const { data } = await supabase.rpc('get_entitlement');
  return Boolean((data as { is_active?: boolean } | null)?.is_active);
}

export async function restore(): Promise<PurchaseResult> {
  if (config.demo) return { ok: true, premium: true };
  if (stripeAvailable()) {
    try { return { ok: true, premium: await syncStripe() }; } catch (e) { return { ok: false, cancelled: false, message: e instanceof Error ? e.message : '' }; }
  }
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, premium: hasPremium(info) };
  } catch (e) {
    return { ok: false, cancelled: false, message: (e as Error).message ?? '' };
  }
}

/** Stripe Customer Portal on the web (card, invoices, cancel, resume); the App Store sheet on iOS. */
export async function manageSubscription(): Promise<void> {
  if (stripeAvailable()) {
    const r = await callFunction<{ url: string }>('billing', { action: 'portal' });
    window.location.assign(r.url);
    return;
  }
  if (!purchasesAvailable()) return;
  await Purchases.showManageSubscriptions();
}
