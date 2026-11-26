import { type Href, router } from 'expo-router';

/**
 * Back, or — when there is no history (a reload, a bookmarked or shared link, a new tab on the web) — to a sensible
 * screen. A bare router.back() does nothing without history, which left buttons spinning or dead.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
