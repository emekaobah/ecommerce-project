// Plain JavaScript (typed by app-identity.d.ts) because each app's app.config.ts imports
// it, and Expo's config loader runs imported files on Node without transpiling TypeScript.

/** The product's name. Rename the product here; app names, schemes and bundle ids follow. */
export const PRODUCT_NAME = "Oja"

export function appIdentity(app) {
  const slug = PRODUCT_NAME.toLowerCase()
  return { name: PRODUCT_NAME, slug, scheme: slug, bundleId: `com.emekaobah.${slug}.${app}` }
}
