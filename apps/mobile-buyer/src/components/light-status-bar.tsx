import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * Light status bar text while the screen is in front, for screens that start on the indigo band
 * or a banner. A tab stays mounted behind the others, so it gives the bar back when it loses focus.
 */
export function LightStatusBar() {
  return useIsFocused() ? <StatusBar style="light" /> : null;
}
