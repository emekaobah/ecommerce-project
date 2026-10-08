import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { resolveVisibleSellerIds } from "@mercurjs/core/api/utils/sellers"
import { addressFormValues, addressFromForm, getAddressConfig } from "@oja/domain"
import { paystackClient } from "../modules/paystack"
import { PaystackRequestError } from "../modules/paystack/client"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../modules/shop-bank-account"
import { saveShopBankAccountWorkflow } from "../workflows/onboarding/save-shop-bank-account"
import { addressCodeOf, hasPin, PICKUP_PIN_NEEDED, type DeliveryAddress } from "./delivery"

// Onboarding gates (#26, docs/design.md): a shop is live, and buyers see its offers, only once
// couriers can collect from it and Oja can pay it. Weekly opening hours join as a third gate
// with the shop-hours module (ADR 0004, #68).

/** What a shop must finish before it goes live, in the order the vendor panel lists them. */
export const ONBOARDING_STEPS = ["pickup_address", "bank_account"] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

type Gates = Record<OnboardingStep, boolean>

type SellerRow = { id: string; address?: DeliveryAddress | null }

/** Which gates each of the shops has passed. */
async function gatesOf(scope: MedusaContainer, sellerIds: string[]): Promise<Map<string, Gates>> {
  if (!sellerIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "address.metadata"],
    filters: { id: sellerIds },
  })
  const accounts = await scope
    .resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
    .listShopBankAccounts({ seller_id: sellerIds }, { select: ["seller_id"] })
  const paid = new Set(accounts.map((a) => a.seller_id))
  return new Map(
    (data as SellerRow[]).map((seller) => [
      seller.id,
      {
        // A Shipbubble code is only stored on a pickup address Shipbubble validated: every route
        // that saves one validates it first (`validatedPickupChange` in lib/delivery.ts). Its pin,
        // which the owner confirmed on the map, is where couriers go (#41).
        pickup_address: addressCodeOf(seller.address) != null && hasPin(seller.address),
        bank_account: paid.has(seller.id),
      },
    ])
  )
}

const allPassed = (gates: Gates | undefined) => !!gates && ONBOARDING_STEPS.every((step) => gates[step])

/**
 * Shops buyers may see: open (approved, not suspended or in a Mercur closure) and through
 * every onboarding gate. Every store route that shows a shop or its offers reads this.
 */
export async function liveSellerIds(scope: MedusaContainer): Promise<string[]> {
  const visible = await resolveVisibleSellerIds(scope)
  const gates = await gatesOf(scope, visible)
  return visible.filter((id) => allPassed(gates.get(id)))
}

/** Whether the shop is live: buyers can see it and add its offers to a cart. */
export async function isLive(scope: MedusaContainer, sellerId: string): Promise<boolean> {
  const [visible, gates] = await Promise.all([resolveVisibleSellerIds(scope), gatesOf(scope, [sellerId])])
  return visible.includes(sellerId) && allPassed(gates.get(sellerId))
}

type PickupAddress = DeliveryAddress & { id: string; postal_code?: string | null }

/** A shop's bank account as its members see it: no Paystack recipient code. */
export type BankAccountView = { bank_code: string; bank_name: string; account_number: string; account_name: string }

/** What the vendor panel's onboarding checklist shows: each gate, and what the shop has entered. */
export type Onboarding = {
  /** Mercur's seller status: a shop also waits for Oja to approve it. */
  status: string
  /** The country the shop's address form is for: its pickup address's, else its currency's region's. */
  country_code: string | null
  is_live: boolean
  steps: { key: OnboardingStep; is_complete: boolean }[]
  pickup_address: PickupAddress | null
  bank_account: BankAccountView | null
}

type OnboardingSellerRow = { id: string; status: string; currency_code: string; address?: PickupAddress | null }

/** The first country of a region trading in the currency. */
async function countryForCurrency(scope: MedusaContainer, currencyCode: string): Promise<string | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "region", fields: ["countries.iso_2"], filters: { currency_code: currencyCode } })
  const regions = data as { countries?: ({ iso_2: string } | null)[] | null }[]
  return regions.flatMap((r) => r.countries ?? []).find((c) => !!c)?.iso_2 ?? null
}

/** A shop's onboarding checklist. */
export async function onboardingOf(scope: MedusaContainer, sellerId: string): Promise<Onboarding> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["id", "status", "currency_code", "address.*"], filters: { id: sellerId } })
  const seller = data[0] as OnboardingSellerRow | undefined
  if (!seller) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Seller ${sellerId} not found`)
  const [gates, visible, [account]] = await Promise.all([
    gatesOf(scope, [sellerId]),
    resolveVisibleSellerIds(scope),
    scope.resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE).listShopBankAccounts({ seller_id: sellerId }),
  ])
  const passed = gates.get(sellerId)
  return {
    status: seller.status,
    country_code: seller.address?.country_code ?? (await countryForCurrency(scope, seller.currency_code)),
    is_live: visible.includes(sellerId) && allPassed(passed),
    steps: ONBOARDING_STEPS.map((key) => ({ key, is_complete: !!passed?.[key] })),
    pickup_address: seller.address ?? null,
    bank_account: account
      ? {
          bank_code: account.bank_code,
          bank_name: account.bank_name,
          account_number: account.account_number,
          account_name: account.account_name,
        }
      : null,
  }
}

/** Paystack's banks for the shop's currency, by name, each once. */
export async function banksFor(currencyCode: string): Promise<{ code: string; name: string }[]> {
  const banks = await requirePaystack().listBanks(currencyCode.toUpperCase())
  const byCode = new Map(banks.filter((b) => b.active).map((b) => [b.code, { code: b.code, name: b.name }]))
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function requirePaystack() {
  const paystack = paystackClient()
  if (!paystack) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Bank accounts can't be checked yet: Paystack isn't set up")
  }
  return paystack
}

/** Paystack refused the account, not our request: anything but our key being wrong. */
const accountRefused = (error: unknown) =>
  error instanceof PaystackRequestError && error.status >= 400 && error.status < 500 && ![401, 403].includes(error.status)

/** The one currency the shop trades and is paid in. */
export async function currencyOf(scope: MedusaContainer, sellerId: string): Promise<string> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["id", "currency_code"], filters: { id: sellerId } })
  const seller = data[0] as { currency_code: string } | undefined
  if (!seller) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Seller ${sellerId} not found`)
  return seller.currency_code
}

/**
 * Sets the bank account a shop is paid into: Paystack resolves the account to its holder's
 * name and registers it as a transfer recipient, which payouts pay (#29). An account Paystack
 * can't find at the bank is refused (400) and the shop keeps the account it had.
 */
export async function saveBankAccount(
  scope: MedusaContainer,
  sellerId: string,
  input: { bank_code: string; account_number: string }
): Promise<BankAccountView> {
  const paystack = requirePaystack()
  const currency = await currencyOf(scope, sellerId)
  const bank = (await banksFor(currency)).find((b) => b.code === input.bank_code)
  if (!bank) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose your bank from the list")

  let accountName: string
  let recipientCode: string
  try {
    const resolved = await paystack.resolveAccount({ account_number: input.account_number, bank_code: input.bank_code })
    accountName = resolved.account_name
    const recipient = await paystack.createTransferRecipient({
      type: "nuban",
      name: accountName,
      account_number: input.account_number,
      bank_code: input.bank_code,
      currency: currency.toUpperCase(),
    })
    recipientCode = recipient.recipient_code
  } catch (error) {
    if (!accountRefused(error)) throw error
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `We couldn't find account ${input.account_number} at ${bank.name}. Check the account number and the bank.`
    )
  }

  await saveShopBankAccountWorkflow(scope).run({
    input: {
      seller_id: sellerId,
      currency_code: currency,
      bank_code: bank.code,
      bank_name: bank.name,
      account_number: input.account_number,
      account_name: accountName,
      recipient_code: recipientCode,
    },
  })
  return { bank_code: bank.code, bank_name: bank.name, account_number: input.account_number, account_name: accountName }
}

/** A pickup address as the vendor panel's form sends it: Medusa's columns, the rest in `metadata`. */
export type PickupAddressInput = {
  country_code: string
  metadata?: { landmark?: string | null; latitude?: number; longitude?: number } | null
} & Partial<Record<"first_name" | "last_name" | "address_1" | "address_2" | "city" | "province" | "postal_code" | "phone", string | null>>

/**
 * Checks a pickup address against its country's form (`@oja/domain`, ADR 0002) and returns it
 * as the seller's address takes it, phone in E.164; refused (400) naming what each wrong field
 * needs. The pin the owner confirmed on the map goes into its metadata; an address without one
 * is refused too, even one entered by hand (#41).
 */
export function pickupAddressFromForm(form: PickupAddressInput) {
  const country = form.country_code.toUpperCase()
  try {
    getAddressConfig(country)
  } catch {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Pickup addresses in ${country} can't be taken yet`)
  }
  const values = addressFormValues(form, country)
  const { latitude, longitude } = form.metadata ?? {}
  const pin = latitude != null && longitude != null ? { latitude, longitude } : null
  const result = pin ? addressFromForm(values, country, pin) : addressFromForm(values, country)
  if (!result.ok || !pin) {
    const problems = [...(result.ok ? [] : Object.values(result.errors)), ...(pin ? [] : [PICKUP_PIN_NEEDED])]
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${problems.join(". ")}.`)
  }
  return result.address
}
