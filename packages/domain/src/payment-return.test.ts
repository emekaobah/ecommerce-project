import { describe, expect, test } from "bun:test"
import { paymentReturn } from "./payment-return"

const RETURN_URL = "oja-buyer://checkout/paid"

describe("paymentReturn", () => {
  test("a redirect to the return URL with Paystack's reference means the buyer paid", () => {
    expect(paymentReturn(`${RETURN_URL}?trxref=ref_1&reference=ref_1`, RETURN_URL)).toEqual({
      kind: "paid",
      reference: "ref_1",
    })
  })

  test("the return URL without a reference means the buyer cancelled on Paystack's page", () => {
    expect(paymentReturn(RETURN_URL, RETURN_URL)).toEqual({ kind: "cancelled" })
  })

  test("any other page is still part of paying", () => {
    expect(paymentReturn("https://checkout.paystack.com/abc123", RETURN_URL)).toBeNull()
    expect(paymentReturn("oja-buyer://checkout/paidx", RETURN_URL)).toBeNull()
  })
})
