// Parsed once at startup; a missing value fails fast instead of surfacing as a network error.
// Each variable is read with a literal `process.env.EXPO_PUBLIC_*` so Expo inlines it at build time.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const env = {
  apiUrl: required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  // Optional: Sentry reports nothing without it (#19).
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
} as const;
