// Web: in-app purchases don't exist here (subscriptions go through Stripe Checkout), and every RevenueCat
// call in purchases.ts is behind purchasesAvailable(), which is false on the web. This stub keeps the
// RevenueCat web SDK (≈1 MB of JavaScript) out of the web bundle. Reaching it is a bug, so it says so.
import type PurchasesType from 'react-native-purchases';

const unavailable = () => { throw new Error('RevenueCat is not available on the web.'); };
const Purchases = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : unavailable) }) as unknown as typeof PurchasesType;

export default Purchases;
