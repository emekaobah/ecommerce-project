import { getAddressConfig } from "./address"
import type { AddressFormErrors, AddressFormValues, BuyerDetails, DeliveryAddress } from "./address-form"
import { toE164 } from "./phone"

// An address saves without a name (#101). The name is needed only at checkout: the courier
// hands a delivered order to the receiver, and a shop hands a collected one to the buyer.

/** Who receives an order. */
export type ReceiverName = { first_name: string; last_name: string }

/** The buyer's name and phone, given at checkout when every shop's order is collected (#12). */
export type Contact = ReceiverName & { phone: string }

/** A person's whole name (first and last), or null when either part is missing. */
export const nameOf = (person: { first_name?: string | null; last_name?: string | null } | null | undefined): ReceiverName | null => {
  const first_name = person?.first_name?.trim()
  const last_name = person?.last_name?.trim()
  return first_name && last_name ? { first_name, last_name } : null
}

/**
 * A delivery address with the name of who receives it: the one it was saved with, else the
 * buyer's account name. Null when neither has a whole name, so checkout asks for it.
 */
export function receiverOf<A extends DeliveryAddress>(
  address: A,
  buyer: BuyerDetails | null | undefined
): (A & ReceiverName) | null {
  const name = nameOf(address) ?? nameOf(buyer)
  return name ? { ...address, ...name } : null
}

type FormResult<K extends string, T> = ({ ok: true } & Record<K, T>) | { ok: false; errors: AddressFormErrors }

/** The receiver's name as typed at checkout, or what each part needs. */
export function nameFromForm(values: AddressFormValues): FormResult<"name", ReceiverName> {
  const name = nameOf(values)
  if (name) return { ok: true, name }
  const errors: AddressFormErrors = {}
  if (!values.first_name?.trim()) errors.first_name = "Enter the first name"
  if (!values.last_name?.trim()) errors.last_name = "Enter the last name"
  return { ok: false, errors }
}

/** The buyer's name and phone as typed at checkout, the phone in E.164, or what each field needs. */
export function contactFromForm(values: AddressFormValues, countryCode: string): FormResult<"contact", Contact> {
  const named = nameFromForm(values)
  const typed = values.phone?.trim() ?? ""
  const phone = typed ? toE164(typed, countryCode) : null
  const errors: AddressFormErrors = named.ok ? {} : { ...named.errors }
  if (!typed) errors.phone = "Enter the phone number"
  else if (!phone) errors.phone = `Enter a phone number like ${getAddressConfig(countryCode).phone.placeholder}`
  if (!named.ok || !phone) return { ok: false, errors }
  return { ok: true, contact: { ...named.name, phone } }
}
