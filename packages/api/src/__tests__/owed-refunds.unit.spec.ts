import { isDue, owedRefund } from "../lib/owed-refunds"

// What an order owes its buyer and hasn't refunded is retried with backoff, and handled by
// Oja's team once Paystack can't make it (#16).
describe("owedRefund", () => {
  const MINUTE = 60 * 1000
  const HOUR = 60 * MINUTE
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 17, 9, 0) + ms)
  const refused = (when: number, reason = "Insufficient balance") => ({
    covers: "items" as const,
    status: "failed",
    created_at: at(when),
    failure_reason: reason,
  })
  const made = (when: number, status = "processed") => ({ covers: "items" as const, status, created_at: at(when), failure_reason: null })

  it("owes nothing once the order owes nothing, or all it owes was settled by hand", () => {
    expect(owedRefund({ owed: 0, settled: 0, refunds: [] })).toBeNull()
    expect(owedRefund({ owed: 2500, settled: 2500, refunds: [refused(0)] })).toBeNull()
  })

  it("tries a refund never attempted at once", () => {
    const owed = owedRefund({ owed: 2500, settled: 0, refunds: [] })!
    expect(owed).toMatchObject({ amount: 2500, attempts: 0, last_error: null, state: "retrying", next_attempt_at: null })
    expect(isDue(owed, at(0))).toBe(true)
  })

  it("waits 5 minutes after the first refusal, an hour after the second, 6 hours after the third", () => {
    const after = (refunds: ReturnType<typeof refused>[]) => owedRefund({ owed: 2500, settled: 0, refunds })!.next_attempt_at
    expect(after([refused(0)])).toEqual(at(5 * MINUTE))
    expect(after([refused(0), refused(5 * MINUTE)])).toEqual(at(5 * MINUTE + HOUR))
    expect(after([refused(0), refused(5 * MINUTE), refused(2 * HOUR)])).toEqual(at(8 * HOUR))

    const once = owedRefund({ owed: 2500, settled: 0, refunds: [refused(0)] })!
    expect(isDue(once, at(5 * MINUTE - 1))).toBe(false)
    expect(isDue(once, at(5 * MINUTE))).toBe(true)
  })

  it("hands the refund to Oja's team after the third retry fails, with Paystack's last word", () => {
    const refunds = [refused(0), refused(5 * MINUTE), refused(2 * HOUR), refused(9 * HOUR, "Transaction has been fully reversed")]
    const owed = owedRefund({ owed: 2500, settled: 0, refunds })!
    expect(owed).toMatchObject({ attempts: 4, last_error: "Transaction has been fully reversed", state: "manual", next_attempt_at: null })
    expect(isDue(owed, at(100 * HOUR))).toBe(false)
  })

  it("hands an amount under Paystack's ₦50 minimum to Oja's team at once", () => {
    expect(owedRefund({ owed: 49.99, settled: 0, refunds: [] })).toMatchObject({ amount: 49.99, attempts: 0, state: "manual" })
    expect(owedRefund({ owed: 2530, settled: 2500, refunds: [] })).toMatchObject({ amount: 30, state: "manual" })
    expect(owedRefund({ owed: 50, settled: 0, refunds: [] })).toMatchObject({ state: "retrying" })
  })

  it("counts only the refusals since a refund of items last went through", () => {
    const refunds = [refused(0), refused(MINUTE), refused(2 * MINUTE), made(3 * MINUTE), refused(HOUR)]
    expect(owedRefund({ owed: 2500, settled: 0, refunds })).toMatchObject({ attempts: 1, state: "retrying" })
  })

  it("counts a refund Paystack accepted and later failed as an attempt, and none of delivery", () => {
    const failedLater = { ...made(0, "failed"), failure_reason: null }
    const delivery = { ...refused(MINUTE), covers: "delivery" as const }
    expect(owedRefund({ owed: 2500, settled: 0, refunds: [failedLater, delivery] })).toMatchObject({
      attempts: 1,
      last_error: null,
      next_attempt_at: at(5 * MINUTE),
    })
  })
})
