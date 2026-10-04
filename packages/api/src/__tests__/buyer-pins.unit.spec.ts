import { withoutBuyerPins } from "../lib/buyer-pins"

const pinned = () => ({
  address_1: "3 Akin Adesola Street",
  metadata: { landmark: "Opposite the Mobil station", latitude: 6.4281, longitude: 3.4219, shipbubble_address_code: 1 },
})
const unpinned = {
  address_1: "3 Akin Adesola Street",
  metadata: { landmark: "Opposite the Mobil station", shipbubble_address_code: 1 },
}

// ADR 0002: shop staff never get the buyer's coordinates; the rider gets them from Shipbubble.
describe("withoutBuyerPins", () => {
  it("leaves the pin out of an order's addresses, keeping the rest", () => {
    const seen = withoutBuyerPins({ order: { id: "order_1", shipping_address: pinned(), billing_address: pinned() } })

    expect(seen).toEqual({ order: { id: "order_1", shipping_address: unpinned, billing_address: unpinned } })
  })

  it("leaves it out of a customer's saved addresses, however deep in the response", () => {
    const seen = withoutBuyerPins({ orders: [{ customer: { addresses: [pinned(), pinned()] } }], count: 1 })

    expect(seen).toEqual({ orders: [{ customer: { addresses: [unpinned, unpinned] } }], count: 1 })
  })

  it("keeps the shop's own pickup address as it is", () => {
    const seller = { seller: { address: pinned() } }

    expect(withoutBuyerPins(seller)).toEqual(seller)
  })

  it("passes values that serialise themselves, like Medusa's BigNumber, through untouched", () => {
    class Amount {
      constructor(private readonly value: number) {}
      toJSON() {
        return this.value
      }
    }
    const total = new Amount(42800)

    const seen = withoutBuyerPins({ order: { total, shipping_address: pinned() } })

    expect(seen.order.total).toBe(total)
    expect(JSON.parse(JSON.stringify(seen)).order.total).toBe(42800)
  })

  it("leaves an address without a pin, or none, alone", () => {
    const body = { order: { shipping_address: { address_1: "x", metadata: null }, billing_address: null }, at: new Date(0) }

    expect(withoutBuyerPins(body)).toEqual(body)
  })
})
