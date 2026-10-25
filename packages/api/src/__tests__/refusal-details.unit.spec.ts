import { MedusaError } from "@medusajs/framework/utils"
import { answeringRefusalDetails } from "../api/refusal-details"
import { Refusal } from "../lib/refusal"

const answer = () => {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) }
  return res
}
const req = {} as any
const next = jest.fn()

// #106: a coded refusal carries what the app needs to word it, such as the shop it names.
describe("answeringRefusalDetails", () => {
  it("answers a refusal in Medusa's shape, with its own fields, keeping its status and type", () => {
    const handler = jest.fn()
    const res = answer()
    const seller = { id: "sel_adire", name: "Adire House" }
    const error = new Refusal(MedusaError.Types.NOT_ALLOWED, "Adire House doesn't deliver to this address", "shop_doesnt_deliver", {
      seller,
      offers_pickup: false,
    })

    answeringRefusalDetails(handler)(error, req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      code: "shop_doesnt_deliver",
      type: "not_allowed",
      message: "Adire House doesn't deliver to this address",
      seller,
      offers_pickup: false,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("leaves every other error to the handler", () => {
    const handler = jest.fn()
    const res = answer()
    const error = new MedusaError(MedusaError.Types.INVALID_DATA, "Stage must be one of…")

    answeringRefusalDetails(handler)(error, req, res, next)

    expect(handler).toHaveBeenCalledWith(error, req, res, next)
    expect(res.json).not.toHaveBeenCalled()
  })
})
