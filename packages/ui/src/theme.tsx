import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { AccessibilityInfo, useColorScheme } from "react-native"
import { darkTheme, lightTheme, type Theme } from "./tokens"

const ThemeContext = createContext<Theme>(lightTheme)
const ReduceMotionContext = createContext(false)

/**
 * Each app wraps its root layout in one provider. The theme follows the system's light or dark
 * setting (there's no in-app toggle), and Reduce Motion is read here once for every component.
 */
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useColorScheme() === "dark" ? darkTheme : lightTheme
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let current = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (current) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    return () => {
      current = false
      subscription.remove()
    }
  }, [])

  return (
    <ThemeContext.Provider value={theme}>
      <ReduceMotionContext.Provider value={reduceMotion}>{children}</ReduceMotionContext.Provider>
    </ThemeContext.Provider>
  )
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** True when the system asks for less motion: no slides or pulses, only cross-fades, and the alarm ring holds still. */
export function useReduceMotion(): boolean {
  return useContext(ReduceMotionContext)
}
