import * as Haptics from "expo-haptics"

// When the phone answers a touch (Foundations, Haptics). Ordinary navigation, scrolling and tab
// switches get none. Nothing waits on them.

export const haptics = {
  /** Order placed, accepted, packed, handed over or collected; review posted. */
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  /** A pick-list line ticked or scanned, a quantity stepped, an option chosen. */
  selection: () => void Haptics.selectionAsync(),
  /** A barcode that matches no line, a wrong pickup code. */
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  /** One beat of the new order's repeating pattern, played with the alarm sound. */
  newOrder: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
}
