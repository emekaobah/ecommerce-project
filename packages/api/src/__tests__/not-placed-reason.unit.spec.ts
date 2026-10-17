import type { NotPlacedReason } from "@oja/domain"
import { notPlacedReason } from "../lib/not-placed-reason"

// A paid cart that fails to become orders says why (#38): from the error its completion failed
// with, or else from what fixing the cart found.
describe("notPlacedReason", () => {
  const causes = (...found: NotPlacedReason[]) => new Set(found)

  it("is why the completion failed, when its error says", () => {
    const sold = "Not enough stock available for item iitem_01 at location sloc_01"
    expect(notPlacedReason(sold, causes("code_used_up", "sold_out"))).toBe("sold_out")
    expect(notPlacedReason("Some variant does not have the required inventory", causes())).toBe("sold_out")
    expect(notPlacedReason("Promotion usage exceeds the limit.", causes("sold_out"))).toBe("code_used_up")
    expect(notPlacedReason("Promotion usage exceeds the budget limit.", causes())).toBe("code_used_up")
    expect(
      notPlacedReason("The cart items required to be assigned to a seller but some of them are missing", causes("sold_out"))
    ).toBe("unavailable")
    expect(notPlacedReason("No shipping method selected but the cart contains seller items that require shipping.", causes())).toBe(
      "delivery"
    )
    expect(notPlacedReason("The cart items require shipping profiles that are not satisfied by the current shipping methods", causes())).toBe(
      "delivery"
    )
  })

  it("is the first thing fixing the cart found when the error doesn't say, or there was none", () => {
    expect(notPlacedReason("Connection terminated", causes("delivery", "sold_out"))).toBe("sold_out")
    expect(notPlacedReason(null, causes("unavailable", "code_used_up"))).toBe("code_used_up")
  })

  it("is other when neither says", () => {
    expect(notPlacedReason("Connection terminated", causes())).toBe("other")
    expect(notPlacedReason(null, causes())).toBe("other")
  })
})
