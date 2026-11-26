// RevenueCat SDK on iOS and Android. The web build resolves revenuecat.web.ts instead (Metro platform
// extensions), so the 1 MB web SDK isn't shipped to browsers, which pay through Stripe.
import Purchases from 'react-native-purchases';

export default Purchases;
