import { useId } from "react"
import { StyleSheet } from "react-native"
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Pattern, Rect, Stop } from "react-native-svg"
import { useTheme } from "../theme"
import { SCALE } from "../tokens"

/** The repeat, in mockup px: a ringed dot, ties and stitches, as the catalogue draws it. */
const TILE = 44

/**
 * Where the pattern fades out so text never sits on its strokes: from the right edge on a band
 * (the text is on the left), from the top on a tall indigo screen, or not at all on an emblem.
 */
export type PatternFade = "right" | "top" | "none"

const FADES: Record<Exclude<PatternFade, "none">, { x2: string; y2: string; stops: [number, number][] }> = {
  // Transparent to 45% across, full at the right edge.
  right: { x2: "1", y2: "0", stops: [[0.45, 0], [1, 1]] },
  // Full at the top, gone by 58% down.
  top: { x2: "0", y2: "1", stops: [[0.28, 1], [0.58, 0]] },
}

export type AdirePatternProps = {
  fade?: PatternFade
  /** How strongly it shows over the indigo: 0.5 on bands, 0.55 on emblems. */
  opacity?: number
}

/**
 * The adire resist-dye pattern, drawn once as an SVG tile and filling its parent. It belongs on
 * indigo only, in brand moments (bands, shop banners and monograms, emblems), behind the content.
 */
export function AdirePattern({ fade = "none", opacity = 0.5 }: Readonly<AdirePatternProps>) {
  const theme = useTheme()
  // SVG ids are document-wide; React's ids carry characters url(#…) doesn't take.
  const id = `adire${useId().replaceAll(/[^a-zA-Z0-9]/g, "")}`
  const stroke = theme.colors.pattern
  const faded = fade === "none" ? null : FADES[fade]
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id={`${id}-tile`} width={TILE * SCALE} height={TILE * SCALE} patternUnits="userSpaceOnUse">
          <G scale={SCALE}>
            <Circle cx={11} cy={11} r={7} fill="none" stroke={stroke} strokeWidth={1.6} />
            <Circle cx={11} cy={11} r={2.4} fill={stroke} />
            <Path d="M26 4v14M30 4v14M34 4v14M38 4v14" stroke={stroke} strokeWidth={1.4} />
            <Path d="M4 30h14M4 34h14M4 38h14" stroke={stroke} strokeWidth={1.4} />
            <Circle cx={33} cy={33} r={7} fill="none" stroke={stroke} strokeWidth={1.6} strokeDasharray="2.5 2.5" />
          </G>
        </Pattern>
        {faded ? (
          <>
            <LinearGradient id={`${id}-fade`} x1="0" y1="0" x2={faded.x2} y2={faded.y2}>
              {faded.stops.map(([offset, shown]) => (
                <Stop key={offset} offset={offset} stopColor="#FFFFFF" stopOpacity={shown} />
              ))}
            </LinearGradient>
            <Mask id={`${id}-mask`}>
              <Rect width="100%" height="100%" fill={`url(#${id}-fade)`} />
            </Mask>
          </>
        ) : null}
      </Defs>
      <Rect
        width="100%"
        height="100%"
        fill={`url(#${id}-tile)`}
        opacity={opacity}
        mask={faded ? `url(#${id}-mask)` : undefined}
      />
    </Svg>
  )
}
