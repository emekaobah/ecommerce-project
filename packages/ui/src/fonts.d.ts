/** The bundled faces by family and weight; each name is both the iOS PostScript name and the Android file name. */
export declare const FONT_FACES: {
  readonly display: { readonly bold: string; readonly extrabold: string }
  readonly text: { readonly regular: string; readonly semibold: string; readonly bold: string; readonly extrabold: string }
}

/** The font files, relative to the app's project root, for expo-font's config plugin. */
export declare function fontFiles(): string[]
