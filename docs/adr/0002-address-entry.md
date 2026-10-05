# 2. Address entry

Status: accepted, 2026-09-26

## Context

Delivery depends on addresses: Shipbubble quotes rates and books labels only between two validated addresses (`sender_address_code`, `receiver_address_code`). Typing an address by hand is slow on a phone. Nigerian street addresses are also unreliable: duplicate street names, missing house numbers, and riders who navigate by landmark. The market is multi-region, so the approach must not assume Nigeria.

Facts that shaped the decision (checked 2026-09-26):

- Shipbubble's `POST /v1/shipping/address/validate` takes one free-text `address` plus optional `latitude`/`longitude`. When coordinates are sent it validates by them and ignores the text. It returns an `address_code`, a formatted address, state and city.
- Google Places API (New) autocomplete and details with an Essentials field mask (`addressComponents`, `formattedAddress`, `location`) cost $2.83 and $5 per 1,000 after 10k free per month each. Requesting `displayName` moves Details to the Pro SKU.
- Google's Address Validation API does not cover Nigeria.
- Many Nigerian Places results resolve only to an area or landmark.

## Decision

### Where

Buyer addresses (saved addresses and checkout) in the buyer app, and the seller's pickup address in the web vendor panel (onboarding gates). Not admin.

### Flow

1. The user searches with Google autocomplete, or, in the buyer app, taps "Use my current location" (`expo-location` + reverse geocode).
2. The result pre-fills the per-country form from `@oja/domain` (`getAddressConfig`). Every field stays editable. Google fills the form; it doesn't replace it.
3. The user confirms or drags a **map pin**. The pin is the location of record.
4. "Can't find it? Enter manually" opens the plain form, but the user still places a pin. The map opens at their current location, or at the chosen state if location is off.
5. On save the backend validates with Shipbubble, sending the pin's coordinates plus the address text, and stores the returned `address_code`. At checkout, the address is re-validated only when the code is missing.

Maps: `react-native-maps` with the Google provider on iOS and Android, so the map matches the autocomplete data. Google Maps JavaScript in the web vendor panel.

### State and LGA (NG)

Filled from Google's `administrative_area_level_1` (state) and `administrative_area_level_2` (LGA). Shipbubble's returned `state` is the fallback. A state-name alias map in `@oja/domain` maps Google's names onto the fixed state list (e.g. "Lagos State" → "Lagos", "Abuja" → "Federal Capital Territory").

Checked 2026-10-04 (#40) with Places API (New) Details for 19 places (Victoria Island, Ikeja, Lekki, Yaba; Wuse, Garki, Gwarinpa; Aba Road, Trans Amadi, Rumuola in Port Harcourt; Kano, Ibadan, Enugu, Benin City, Uyo, Calabar, Keffi, Zaria, Mararaba) and Geocoding API reverse lookups in Lagos, Abuja and Port Harcourt:

- `administrative_area_level_1` is the state in every result. Its `longText` already matches the state list: "Lagos", "Federal Capital Territory" (not "Abuja"), "Rivers", "Akwa Ibom", "Cross River", "Nasarawa". `shortText` is a code ("LA", "RV"), so the long name is used. The alias map stays as a guard against variants ("Lagos State", "Abuja", "FCT", "Nassarawa").
- `administrative_area_level_2` is the LGA, in Google's spelling: "Eti Osa" (officially Eti-Osa), "Port-Harcourt", "Abuja Municipal Area Council", "Obio/Akpor". The LGA field is free text, so it is filled as Google writes it and the buyer can correct it.
- `administrative_area_level_3` is a ward ("Ikoyi I", "Worji"), not the LGA. `locality` is the town ("Lagos", "Port Harcourt", "Abuja").
- Area-only results are common: Gwarinpa, Trans Amadi and Garki have no `route` or `street_number`, so the street field is left for the buyer.
- Reverse geocoding returns the same components (snake_case: `long_name`) with a street address first.

### Form fields

`address_2` is "Apartment, floor". A separate, optional "Landmark / directions for the rider" field lives in `metadata.landmark`, with an example placeholder. The landmark is printed on the label.

### Backend proxy

- Apps never call Google directly. The backend exposes lookup routes: store routes for a signed-in customer, vendor routes for a member. No guest access.
- A thin `AddressLookupProvider` interface (`suggest`, `details`, `reverseGeocode`) with one Google implementation, chosen per region like the shipment provider.
- The server derives the country restriction (`includedRegionCodes`) from the Medusa region's countries: the cart's region at checkout, or the region the app shops in when a buyer adds a saved address with no cart (#18). The app never hardcodes a country.
- The client generates the Places session token and passes it through, so billing stays per session. Details requests use the Essentials field mask only.

### Storage

In the address `metadata` (customer address, cart shipping address, seller pickup address):

- `latitude`, `longitude`: the user-confirmed pin (or Shipbubble's returned coordinates), never Google's raw result, which Google's terms don't let us keep.
- `landmark`
- `shipbubble_address_code`

No `place_id`, since nothing needs it. No custom module until something queries by location. Saved addresses are Medusa's customer addresses (#18); saving one, or changing its metadata, needs the pin. Medusa merges an edit's metadata, so the app clears a removed landmark by sending it empty. A saved address isn't validated with Shipbubble when it is saved: checkout validates whichever address is set on the cart, and never takes a code from the request, so saved addresses carry no `shipbubble_address_code`.

### Privacy

Coordinates go to Shipbubble, the buyer and admin only. The vendor API returns shop staff the formatted address and landmark, never coordinates.

## Consequences

- Every address that reaches checkout has a pin and a Shipbubble `address_code`, so rates never fail on an unparseable address.
- Adding a country means a region, an `@oja/domain` address config and, if Google is weak there, another `AddressLookupProvider`. No app release is needed for the provider.
- New keys: a Places/Geocoding server key, and Maps SDK keys for iOS and Android (in the Expo config plugin). Set a Google Cloud budget alert.
- The pin screen adds a step to address entry. It is the cost of reliable delivery where street addresses aren't.
