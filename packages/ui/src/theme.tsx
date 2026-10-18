import { createContext, useContext, type ReactNode } from "react"
import { buyerTheme, type Theme } from "./tokens"

const ThemeContext = createContext<Theme>(buyerTheme)

/** Each app wraps its root layout in one provider: buyerTheme or vendorTheme. */
export function ThemeProvider({ theme, children }: Readonly<{ theme: Theme; children: ReactNode }>) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
