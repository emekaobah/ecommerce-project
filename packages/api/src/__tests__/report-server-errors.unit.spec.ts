import { MedusaError } from "@medusajs/framework/utils"
import { reportServerErrors } from "../api/report-server-errors"

const setup = () => {
  const handler = jest.fn()
  const report = jest.fn()
  return { handler, report, onError: reportServerErrors(report, handler) }
}

const req = {} as any
const res = {} as any
const next = jest.fn()

// #19: Sentry hears about the API's own failures, not about buyers' bad requests.
describe("reportServerErrors", () => {
  it("reports an error that answers 500, then lets Medusa answer it", () => {
    const { handler, report, onError } = setup()
    const error = new Error("boom")

    onError(error, req, res, next)

    expect(report).toHaveBeenCalledWith(error)
    expect(handler).toHaveBeenCalledWith(error, req, res, next)
  })

  it("reports a database error", () => {
    const { report, onError } = setup()
    const error = new MedusaError(MedusaError.Types.DB_ERROR, "connection lost")

    onError(error, req, res, next)

    expect(report).toHaveBeenCalledWith(error)
  })

  it.each([
    MedusaError.Types.NOT_FOUND,
    MedusaError.Types.INVALID_DATA,
    MedusaError.Types.NOT_ALLOWED,
    MedusaError.Types.UNAUTHORIZED,
    MedusaError.Types.CONFLICT,
  ])("doesn't report a %s error, but still answers it", (type) => {
    const { handler, report, onError } = setup()
    const error = new MedusaError(type, "no")

    onError(error, req, res, next)

    expect(report).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith(error, req, res, next)
  })
})
