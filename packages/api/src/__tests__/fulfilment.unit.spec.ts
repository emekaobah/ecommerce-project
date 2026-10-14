import { newFulfilment, transition } from "@oja/domain"

// Proves the API consumes the shared fulfilment state machine from @oja/domain.
// The machine's own behaviour is tested in packages/domain.
describe("@oja/domain fulfilment state machine", () => {
  it("accepts a new order on a staff action", () => {
    expect(
      transition(newFulfilment("delivery"), {
        source: "staff",
        type: "accept",
        actor: "mem_staff_1",
        at: "2026-09-26T10:00:00.000Z",
      })
    ).toEqual({ ok: true, fulfilment: { method: "delivery", state: "accepted" } })
  })
})
