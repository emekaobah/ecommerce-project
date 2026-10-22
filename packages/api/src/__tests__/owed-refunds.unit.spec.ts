import { isDue, NO_ACCOUNT_REASON, owedAttempts, owedLines, owedRefund, paystackPart } from "../lib/owed-refunds"

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
    expect(owedRefund({ owed: 0, settlements: [], refunds: [] })).toBeNull()
    expect(owedRefund({ owed: 2500, settlements: [{ amount: 2500, created_at: at(MINUTE) }], refunds: [refused(0)] })).toBeNull()
  })

  it("tries a refund never attempted at once", () => {
    const owed = owedRefund({ owed: 2500, settlements: [], refunds: [] })!
    expect(owed).toMatchObject({ amount: 2500, attempts: 0, last_error: null, state: "retrying", next_attempt_at: null })
    expect(isDue(owed, at(0))).toBe(true)
  })

  it("waits 5 minutes after the first refusal, an hour after the second, 6 hours after the third", () => {
    const after = (refunds: ReturnType<typeof refused>[]) => owedRefund({ owed: 2500, settlements: [], refunds })!.next_attempt_at
    expect(after([refused(0)])).toEqual(at(5 * MINUTE))
    expect(after([refused(0), refused(5 * MINUTE)])).toEqual(at(5 * MINUTE + HOUR))
    expect(after([refused(0), refused(5 * MINUTE), refused(2 * HOUR)])).toEqual(at(8 * HOUR))

    const once = owedRefund({ owed: 2500, settlements: [], refunds: [refused(0)] })!
    expect(isDue(once, at(5 * MINUTE - 1))).toBe(false)
    expect(isDue(once, at(5 * MINUTE))).toBe(true)
  })

  it("hands the refund to Oja's team after the third retry fails, with Paystack's last word", () => {
    const refunds = [refused(0), refused(5 * MINUTE), refused(2 * HOUR), refused(9 * HOUR, "Transaction has been fully reversed")]
    const owed = owedRefund({ owed: 2500, settlements: [], refunds })!
    expect(owed).toMatchObject({ attempts: 4, last_error: "Transaction has been fully reversed", state: "manual", next_attempt_at: null })
    expect(isDue(owed, at(100 * HOUR))).toBe(false)
  })

  it("hands an amount under Paystack's ₦50 minimum to Oja's team at once", () => {
    expect(owedRefund({ owed: 49.99, settlements: [], refunds: [] })).toMatchObject({ amount: 49.99, attempts: 0, state: "manual" })
    expect(owedRefund({ owed: 2530, settlements: [{ amount: 2500, created_at: at(0) }], refunds: [] })).toMatchObject({ amount: 30, state: "manual" })
    expect(owedRefund({ owed: 50, settlements: [], refunds: [] })).toMatchObject({ state: "retrying" })
  })

  it("counts only the refusals since a refund of items last went through", () => {
    const refunds = [refused(0), refused(MINUTE), refused(2 * MINUTE), made(3 * MINUTE), refused(HOUR)]
    expect(owedRefund({ owed: 2500, settlements: [], refunds })).toMatchObject({ attempts: 1, state: "retrying" })
  })

  it("starts a fresh backoff for what a later edit owes once the earlier refund was settled by hand", () => {
    const refunds = [refused(0), refused(5 * MINUTE), refused(2 * HOUR), refused(9 * HOUR)]
    const settlements = [{ amount: 2500, created_at: at(10 * HOUR) }]
    expect(owedRefund({ owed: 4000, settlements, refunds })).toMatchObject({
      amount: 1500,
      attempts: 0,
      last_error: null,
      state: "retrying",
      next_attempt_at: null,
    })
    expect(owedRefund({ owed: 4000, settlements, refunds: [...refunds, refused(11 * HOUR)] })).toMatchObject({
      attempts: 1,
      next_attempt_at: at(11 * HOUR + 5 * MINUTE),
    })
  })

  it("counts a refund Paystack accepted and later failed as an attempt, and none of delivery", () => {
    const failedLater = { ...made(0, "failed"), failure_reason: null }
    const delivery = { ...refused(MINUTE), covers: "delivery" as const }
    expect(owedRefund({ owed: 2500, settlements: [], refunds: [failedLater, delivery] })).toMatchObject({
      attempts: 1,
      last_error: null,
      next_attempt_at: at(5 * MINUTE),
    })
  })

  // #13: a refund that needed the buyer's bank account for 7 days, of anything.
  describe("a refund handed to Oja's team when the buyer gave no bank account", () => {
    const DAY = 24 * HOUR
    const handedOver = (status = "needs-attention") => ({
      covers: "all" as const,
      status,
      amount: 9000,
      created_at: at(0),
      handed_over_at: at(7 * DAY),
    })

    it("is owed by hand until settled or Paystack settles it", () => {
      const owed = owedRefund({ owed: 0, settlements: [], refunds: [handedOver()] })!
      expect(owed).toMatchObject({
        amount: 9000,
        by_hand: 9000,
        attempts: 0,
        last_error: NO_ACCOUNT_REASON,
        state: "manual",
        next_attempt_at: null,
      })
      expect(paystackPart(owed)).toBe(0)
      expect(owedRefund({ owed: 0, settlements: [{ amount: 9000, created_at: at(8 * DAY) }], refunds: [handedOver()] })).toBeNull()
      expect(owedRefund({ owed: 0, settlements: [], refunds: [handedOver("processed")] })).toBeNull()
    })

    it("leaves what else the order owes for Paystack to try first, and to retry", () => {
      const owed = owedRefund({ owed: 2500, settlements: [], refunds: [handedOver()] })!
      expect(owed).toMatchObject({ amount: 11500, by_hand: 9000, attempts: 0, last_error: null, state: "retrying", next_attempt_at: null })
      expect(paystackPart(owed)).toBe(2500)
      expect(isDue(owed, at(8 * DAY))).toBe(true)

      const refusedOnce = owedRefund({ owed: 2500, settlements: [], refunds: [handedOver(), refused(8 * DAY)] })!
      expect(refusedOnce).toMatchObject({ by_hand: 9000, attempts: 1, last_error: "Insufficient balance", state: "retrying" })
      expect(refusedOnce.next_attempt_at).toEqual(at(8 * DAY + 5 * MINUTE))
    })

    it("hands the rest to Oja's team too once Paystack can't make it", () => {
      const refusals = [refused(8 * DAY), refused(8 * DAY + HOUR), refused(8 * DAY + 3 * HOUR), refused(8 * DAY + 10 * HOUR)]
      expect(owedRefund({ owed: 2500, settlements: [], refunds: [handedOver(), ...refusals] })).toMatchObject({
        amount: 11500,
        state: "manual",
      })
      expect(owedRefund({ owed: 30, settlements: [], refunds: [handedOver()] })).toMatchObject({ amount: 9030, state: "manual" })
    })

    it("is no longer the team's once they settle it, whatever the order owes since", () => {
      const owed = owedRefund({ owed: 4000, settlements: [{ amount: 9000, created_at: at(8 * DAY) }], refunds: [handedOver()] })!
      expect(owed).toMatchObject({ amount: 4000, by_hand: 0, state: "retrying" })
      expect(paystackPart(owed)).toBe(4000)
    })

    it("is the team's when handed over after they settled what the order owed before", () => {
      const owed = owedRefund({ owed: 2500, settlements: [{ amount: 2500, created_at: at(DAY) }], refunds: [handedOver()] })!
      expect(owed).toMatchObject({ amount: 9000, by_hand: 9000, state: "manual", last_error: NO_ACCOUNT_REASON })
    })
  })
})

// A refund names the order lines it is for (#61): a retry is for what its attempts were, and a
// refund owed on top of a refused one is for both.
describe("owedLines", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 22, 9, 0) + ms)
  const attempt = (when: number, status: string, lines: Record<string, number> | null) => ({
    covers: "items" as const,
    status,
    created_at: at(when),
    lines,
  })

  it("is what an edit or cancellation just took off when nothing was attempted before", () => {
    expect(owedLines([], { ordli_rice: 1 })).toEqual({ ordli_rice: 1 })
  })

  it("is the latest attempt's lines for a retry", () => {
    const attempts = owedAttempts({ settlements: [], refunds: [attempt(0, "failed", { ordli_rice: 1 }), attempt(1000, "failed", { ordli_rice: 1 })] })
    expect(owedLines(attempts)).toEqual({ ordli_rice: 1 })
  })

  it("adds what was just taken off to the lines a refused refund was for", () => {
    const attempts = owedAttempts({ settlements: [], refunds: [attempt(0, "failed", { ordli_rice: 1 })] })
    expect(owedLines(attempts, { ordli_rice: 1, ordli_beans: 1 })).toEqual({ ordli_rice: 2, ordli_beans: 1 })
  })

  it("leaves out lines a later refund made, or a settlement by hand, already covered", () => {
    const refunds = [attempt(0, "failed", { ordli_rice: 1 }), attempt(1000, "processed", { ordli_rice: 1 })]
    expect(owedLines(owedAttempts({ settlements: [], refunds }), { ordli_beans: 1 })).toEqual({ ordli_beans: 1 })
    const settled = owedAttempts({ settlements: [{ amount: 2500, created_at: at(500) }], refunds: [attempt(0, "failed", { ordli_rice: 1 })] })
    expect(owedLines(settled, { ordli_beans: 1 })).toEqual({ ordli_beans: 1 })
  })

  it("names no lines for a refund owed before refunds named them", () => {
    expect(owedLines(owedAttempts({ settlements: [], refunds: [attempt(0, "failed", null)] }))).toBeNull()
  })
})
