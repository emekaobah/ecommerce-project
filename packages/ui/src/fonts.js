// Plain JavaScript (typed by fonts.d.ts) because each app's app.config.ts imports it, and
// Expo's config loader runs imported files on Node without transpiling TypeScript.

/**
 * One family name per weight: Android can't pick a weight inside a family, so a style names
 * its face, never a fontWeight (catalogue Foundations, Fonts). Each file in assets/fonts is
 * named after its face's PostScript name, which is the name iOS matches; Android matches the
 * file name, so the same string works on both.
 */
export const FONT_FACES = {
  /** Bricolage Grotesque, for display: 18 mockup px and up. */
  display: { bold: "BricolageGrotesque-Bold", extrabold: "BricolageGrotesque-ExtraBold" },
  /** Manrope, for everything else. */
  text: {
    regular: "Manrope-Regular",
    semibold: "Manrope-SemiBold",
    bold: "Manrope-Bold",
    extrabold: "Manrope-ExtraBold",
  },
}

/** The font files, relative to the app's project root, for expo-font's config plugin. */
export function fontFiles() {
  return [...Object.values(FONT_FACES.display), ...Object.values(FONT_FACES.text)].map(
    (face) => `../../packages/ui/assets/fonts/${face}.ttf`,
  )
}
