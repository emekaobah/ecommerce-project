// Plain JavaScript (typed by app-identity.d.ts) because each app's app.config.ts imports
// it, and Expo's config loader runs imported files on Node without transpiling TypeScript.

/** The product's name. Rename the product here; app names, schemes and bundle ids follow. */
export const PRODUCT_NAME = "Oja"

/**
 * The Apple Developer Program team both iOS apps are signed with (the paid membership; the
 * free personal team can't sign Push Notifications or Sign in with Apple).
 */
export const APPLE_TEAM_ID = "HP5MVM38V6"

export function appIdentity(app) {
  const base = PRODUCT_NAME.toLowerCase()
  const bundleId = `com.emekaobah.${base}.${app}`
  if (app === "buyer") return { name: PRODUCT_NAME, slug: base, scheme: base, bundleId }
  // The vendor app gets its own name and scheme so both apps install side by side.
  return { name: `${PRODUCT_NAME} Vendor`, slug: `${base}-vendor`, scheme: `${base}vendor`, bundleId }
}

/**
 * Which of Apple's push services an EAS build profile's phones use, as its iOS entitlement says
 * it and as the backend records it with each token. Production and internal (ad hoc) builds are
 * production; only a development-signed build gets sandbox tokens.
 */
export function apnsEnvironment(profile) {
  return profile === "production" || profile === "preview"
    ? { entitlement: "production", host: "production" }
    : { entitlement: "development", host: "sandbox" }
}
