// Plain JavaScript (typed by app-identity.d.ts) because each app's app.config.ts imports
// it, and Expo's config loader runs imported files on Node without transpiling TypeScript.

/** The product's name. Rename the product here; app names, schemes and bundle ids follow. */
export const PRODUCT_NAME = "Oja"

export function appIdentity(app) {
  const base = PRODUCT_NAME.toLowerCase()
  const bundleId = `com.emekaobah.${base}.${app}`
  if (app === "buyer") return { name: PRODUCT_NAME, slug: base, scheme: base, bundleId }
  // The vendor app gets its own name and scheme so both apps install side by side.
  return { name: `${PRODUCT_NAME} Vendor`, slug: `${base}-vendor`, scheme: `${base}vendor`, bundleId }
}
