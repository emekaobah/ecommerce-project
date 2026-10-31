import type { ReviewKind } from '@oja/domain';
import { router } from 'expo-router';

import type { Listing } from '@/api/listings';

/** Opens a product in the listing's shop context: there is no product page without a shop (docs/design.md). */
export function openListing(listing: { seller: Pick<Listing['seller'], 'id'>; product: Pick<Listing['product'], 'id'> }) {
  router.push({ pathname: '/product/[id]', params: { id: listing.product.id, seller: listing.seller.id } });
}

/** Opens a shop's page: its header and every product it sells. */
export function openShop(seller: Pick<Listing['seller'], 'id'>) {
  router.push({ pathname: '/seller/[id]', params: { id: seller.id } });
}

/** Opens one of the buyer's order groups: each shop's order of a checkout. */
export function openOrderGroup(group: { id: string }) {
  router.push({ pathname: '/order/[id]', params: { id: group.id } });
}

/** Opens every published review of a shop or product; the title names what they're of. */
export function openReviews(kind: ReviewKind, id: string, title: string) {
  router.push({ pathname: '/reviews', params: { kind, id, title } });
}

/** Opens the form to review one shop's order of an order group, once the buyer has received it (#7). */
export function openWriteReview(group: { id: string }, order: { id: string }) {
  router.push({ pathname: '/review/[id]', params: { id: order.id, group: group.id } });
}

/** Opens a category's listings; the name titles the screen before anything loads. */
export function openCategory(category: { id: string; name: string }) {
  router.push({ pathname: '/category/[id]', params: { id: category.id, name: category.name } });
}

/** Opens every review the buyer has written (#81). */
export function openMyReviews() {
  router.push('/my-reviews');
}

/**
 * Opens the cart as a sheet over the current screen, so the buyer comes back to it: switching to
 * the Cart tab would discard a product or order opened above the tabs.
 */
export function openCartSheet() {
  router.push('/cart-sheet');
}

/** What goes on once the root stack's transition in flight ends: `afterStackSettles`. */
const waiting = new Set<() => void>();

/**
 * Called by the root stack when a native transition ends (react-native-screens'
 * `onFinishTransitioning`): a sheet has gone, or a screen has been pushed or popped.
 */
export function stackSettled() {
  const settled = [...waiting];
  waiting.clear();
  settled.forEach((go) => go());
}

/** Longer than any sheet or push takes: past it, the stack is taken to have settled without saying so. */
const SETTLE_FALLBACK_MS = 1000;

/**
 * Goes on once the transition just started ends: pushing while a native sheet is still
 * dismissing can drop the push, or land it under the sheet.
 */
function afterStackSettles(go: () => void) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    waiting.delete(once);
    go();
  };
  const fallback = setTimeout(once, SETTLE_FALLBACK_MS);
  waiting.add(once);
}

/**
 * Closes the sheet in front, then, once it has gone, goes on. Called from a sheet route, so the
 * next screen opens over the screen under the sheet rather than inside the sheet.
 */
export function closeSheetThen(go: () => void) {
  afterStackSettles(go);
  router.back();
}

/** A root stack route, with the state of the navigator inside it once that has one. */
type StackRoute = { name: string; state?: { index?: number; routes: readonly { name: string }[] } };

/** Whether a root stack route is the tabs showing the Cart tab. Until a tab is chosen, they show Home. */
function isCartTab(route: StackRoute | undefined) {
  const tabs = route?.name === '(tabs)' ? route.state : undefined;
  return tabs?.routes[tabs.index ?? 0]?.name === 'cart';
}

/**
 * Back to the cart from checkout's changes sheet: pops the sheet and checkout together, as going
 * back does, so a shop cart's items return to the cart. Checkout started from the Cart tab is back
 * on it; from anywhere else, the cart opens as a sheet over that screen once checkout has gone,
 * rather than discarding it for the Cart tab.
 */
export function backToCart(stack: { routes: readonly StackRoute[] } | undefined) {
  const routes = stack?.routes ?? [];
  const checkout = routes.findLastIndex((route) => route.name === 'checkout/index');
  if (!isCartTab(routes[checkout - 1])) afterStackSettles(openCartSheet);
  router.dismiss(2);
}
