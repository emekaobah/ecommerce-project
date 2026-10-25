import { guestSpotName, type GuestSpot } from '@oja/domain';
import * as Location from 'expo-location';

/** Where a guest is: their spot, or why there's none (location refused, or the phone couldn't tell). */
export type Located = { spot: GuestSpot } | { refused: true } | { unavailable: true };

/**
 * The phone's position, named by the phone's own geocoder (ADR 0015: no backend lookup for a
 * guest). A spot measures shops to about a kilometre, so a balanced fix is enough.
 */
export async function locateSpot(): Promise<Located> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return { refused: true };
  try {
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const here = { latitude: coords.latitude, longitude: coords.longitude };
    const [place] = await Location.reverseGeocodeAsync(here).catch(() => []);
    return { spot: { ...here, name: guestSpotName(place) } };
  } catch {
    return { unavailable: true };
  }
}
