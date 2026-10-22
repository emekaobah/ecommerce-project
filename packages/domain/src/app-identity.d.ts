/** The product's name. Rename the product here; app names, schemes and bundle ids follow. */
export declare const PRODUCT_NAME: string

/** The Apple Developer Program team both iOS apps are signed with. */
export declare const APPLE_TEAM_ID: string

export type AppIdentity = {
  /** Display name under the app icon. */
  name: string
  slug: string
  /** Deep-link scheme, e.g. `oja://product/123`. */
  scheme: string
  /** iOS bundle identifier and Android package. */
  bundleId: string
}

/** Name, scheme and bundle id for an app, derived from the product name. */
export declare function appIdentity(app: "buyer" | "vendor"): AppIdentity
