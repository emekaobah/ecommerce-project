/**
 * Formats a Medusa amount (major units, e.g. 1500 = ₦1,500) for display.
 * The currency always comes from the region or order; never hardcode one.
 */
export function formatMoney(amount: number, currencyCode: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount)
}
