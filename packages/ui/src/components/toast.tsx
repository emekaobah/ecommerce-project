import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native"
import { PressableSurface } from "./pressable-surface"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useReduceMotion, useTheme } from "../theme"
import { Icon } from "./icon"
import { Text } from "./text"

/** "done" after something worked; "problem" when something quietly didn't, like a refresh. */
export type ToastTone = "done" | "problem"

export type ToastMessage = {
  message: string
  tone?: ToastTone
  /** "View cart" after "3 items added": a button on the toast, which closes it. Only a toast with one takes touches. */
  action?: { label: string; onPress: () => void }
}

const ToastContext = createContext<(toast: ToastMessage) => void>(() => {})

/** Shows a short message over the screen: `useToast()({ message: "Couldn't refresh", tone: "problem" })`. */
export function useToast(): (toast: ToastMessage) => void {
  return useContext(ToastContext)
}

/**
 * Each app wraps its screens in one, inside the theme. A toast slides up under the status bar,
 * stays 4s and leaves; under Reduce Motion it cross-fades instead. A new one replaces the last.
 * One with an action stays three times as long while a screen reader is on, so its button can be reached.
 */
export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null)
  const next = useRef(0)
  const show = useCallback((message: ToastMessage) => {
    next.current += 1
    setToast({ ...message, id: next.current })
  }, [])
  const hide = useCallback(() => setToast(null), [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <Toast key={toast.id} toast={toast} onDone={hide} /> : null}
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDone }: Readonly<{ toast: ToastMessage; onDone: () => void }>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduceMotion = useReduceMotion()
  const shown = useRef(new Animated.Value(0)).current
  const problem = toast.tone === "problem"
  const { action } = toast
  const hasAction = Boolean(action)
  const [screenReader, setScreenReader] = useState(false)

  useEffect(() => {
    if (!hasAction) return
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader)
    const listener = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader)
    return () => listener.remove()
  }, [hasAction])

  const actionLabel = action?.label
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(actionLabel ? `${toast.message}. ${actionLabel}` : toast.message)
  }, [toast.message, actionLabel])

  useEffect(() => {
    const fade = (toValue: number, duration: number) => Animated.timing(shown, { toValue, duration, useNativeDriver: true })
    const hold = hasAction && screenReader ? theme.motion.toastHold * 3 : theme.motion.toastHold
    const run = Animated.sequence([
      fade(1, reduceMotion ? theme.motion.crossFade : theme.motion.toastSlide),
      Animated.delay(hold),
      fade(0, reduceMotion ? theme.motion.crossFade : theme.motion.toastSlide),
    ])
    run.start(({ finished }) => {
      if (finished) onDone()
    })
    return () => run.stop()
  }, [shown, reduceMotion, theme.motion, hasAction, screenReader, onDone])

  // Slides up into place from just below it (Foundations, Motion), and back down as it leaves.
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : theme.space[6], 0] })

  return (
    <Animated.View
      pointerEvents={action ? "box-none" : "none"}
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          top: insets.top + theme.space[2],
          left: theme.space[4],
          right: theme.space[4],
          gap: theme.space[2],
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.inverse,
          opacity: shown,
          transform: [{ translateY }],
        },
      ]}
    >
      <Icon name={problem ? "alert" : "check"} use="chip" color={problem ? theme.colors.inverseDanger : theme.colors.inverseSuccess} />
      <View style={styles.text}>
        <Text variant="meta" weight="semibold" style={{ color: theme.colors.onInverse }}>
          {toast.message}
        </Text>
      </View>
      {action ? (
        <PressableSurface
          accessibilityRole="button"
          onPress={() => {
            action.onPress()
            onDone()
          }}
          style={[styles.action, { minHeight: theme.hitArea, minWidth: theme.hitArea, paddingHorizontal: theme.space[2], borderRadius: theme.radius.sm }]}
        >
          <Text variant="meta" weight="extrabold" style={{ color: theme.colors.onInverse }}>
            {action.label}
          </Text>
        </PressableSurface>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  toast: { position: "absolute", flexDirection: "row", alignItems: "center" },
  text: { flex: 1 },
  action: { alignItems: "center", justifyContent: "center" },
})
