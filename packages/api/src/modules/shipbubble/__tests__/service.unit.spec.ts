import { ShipbubbleFulfillmentProviderService } from "../service"

describe("Shipbubble provider", () => {
  const env = process.env.NODE_ENV
  afterEach(() => {
    process.env.NODE_ENV = env
  })

  it("refuses to start without an API key outside tests", () => {
    process.env.NODE_ENV = "production"
    expect(() => ShipbubbleFulfillmentProviderService.validateOptions({})).toThrow(/SHIPBUBBLE_API_KEY/)
    process.env.NODE_ENV = "development"
    expect(() => ShipbubbleFulfillmentProviderService.validateOptions({})).toThrow(/SHIPBUBBLE_API_KEY/)
    expect(() => ShipbubbleFulfillmentProviderService.validateOptions({ apiKey: "sb_sandbox_x" })).not.toThrow()
  })

  it("prices a shop's delivery at the rate checkout chose, VAT included", async () => {
    const provider = new ShipbubbleFulfillmentProviderService()

    await expect(provider.calculatePrice({}, { quote: { amount: 2500 } })).resolves.toEqual({
      calculated_amount: 2500,
      is_calculated_price_tax_inclusive: true,
    })
  })

  it("won't price or take a delivery that checkout didn't quote", async () => {
    const provider = new ShipbubbleFulfillmentProviderService()

    await expect(provider.calculatePrice({}, {})).rejects.toThrow(/at checkout/)
    await expect(provider.validateFulfillmentData({}, { quote: "free" })).rejects.toThrow(/at checkout/)
  })
})
