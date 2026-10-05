import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { ADDRESS, PIN } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

/** Ada's office, pinned on Adeola Odeku Street, with no landmark. */
const OFFICE = {
  ...ADDRESS,
  address_1: "12 Adeola Odeku Street",
  address_2: null,
  metadata: { latitude: 6.4302, longitude: 3.4178 },
}

// A buyer's saved delivery addresses (#18) are Medusa's customer addresses, through the store's
// own routes; the landmark and the pin she confirmed live in their metadata (ADR 0002).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>

    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      headers = { "x-publishable-api-key": keys[0].token }
    })

    /** A signed-in buyer's request config; a new email is a new buyer. */
    const buyer = (email: string) => ({
      headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
    })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const addresses = async (as: object) =>
      (await api.get("/store/customers/me/addresses?fields=*", as)).data.addresses as any[]
    const save = async (as: object, address: object) => {
      await api.post("/store/customers/me/addresses", address, as)
      const all = await addresses(as)
      return all[all.length - 1].id as string
    }

    it("keeps the landmark and the pin with the address", async () => {
      const ada = buyer("ada-keeps@oja.test")

      await save(ada, { ...ADDRESS, is_default_shipping: true })

      expect(await addresses(ada)).toEqual([
        expect.objectContaining({
          address_1: ADDRESS.address_1,
          city: ADDRESS.city,
          province: ADDRESS.province,
          is_default_shipping: true,
          metadata: { landmark: ADDRESS.metadata.landmark, ...PIN },
        }),
      ])
    })

    it("has one default: making another the default unsets the first", async () => {
      const ada = buyer("ada-default@oja.test")
      const home = await save(ada, { ...ADDRESS, is_default_shipping: true })
      const office = await save(ada, OFFICE)

      await api.post(`/store/customers/me/addresses/${office}`, { is_default_shipping: true }, ada)

      const defaults = Object.fromEntries((await addresses(ada)).map((a) => [a.id, a.is_default_shipping]))
      expect(defaults).toEqual({ [home]: false, [office]: true })
    })

    // Medusa merges an edit's metadata into the address's: a key is removed only when sent empty,
    // which is how the app clears a landmark the buyer deleted (`savedAddressEdit`).
    it("merges the metadata on an edit: a moved pin moves, and a landmark sent empty is gone", async () => {
      const ada = buyer("ada-edits@oja.test")
      const home = await save(ada, ADDRESS)
      const moved = { latitude: 6.4285, longitude: 3.4222 }

      await api.post(`/store/customers/me/addresses/${home}`, { ...ADDRESS, metadata: moved }, ada)
      const kept = (await addresses(ada))[0].metadata
      await api.post(`/store/customers/me/addresses/${home}`, { ...ADDRESS, metadata: { ...moved, landmark: "" } }, ada)

      expect(kept).toEqual({ landmark: ADDRESS.metadata.landmark, ...moved })
      expect((await addresses(ada))[0].metadata).toEqual(moved)
    })

    it("deletes an address", async () => {
      const ada = buyer("ada-deletes@oja.test")
      const home = await save(ada, ADDRESS)
      const office = await save(ada, OFFICE)

      await api.delete(`/store/customers/me/addresses/${home}`, ada)

      expect((await addresses(ada)).map((a) => a.id)).toEqual([office])
    })

    it("is the buyer's own: another buyer can neither see nor change it", async () => {
      const ada = buyer("ada-own@oja.test")
      const bola = buyer("bola-own@oja.test")
      const home = await save(ada, ADDRESS)

      expect(await addresses(bola)).toEqual([])
      expect(await status(api.post(`/store/customers/me/addresses/${home}`, OFFICE, bola))).toBe(404)
      expect(await status(api.delete(`/store/customers/me/addresses/${home}`, bola))).toBe(404)
    })

    describe("needs the pin the buyer confirmed", () => {
      it("to save an address", async () => {
        const ada = buyer("ada-unpinned@oja.test")

        const res = await api
          .post("/store/customers/me/addresses", { ...ADDRESS, metadata: { landmark: "By the gate" } }, ada)
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/Place the delivery pin on the map/)
        expect(await addresses(ada)).toEqual([])
      })

      it("to change an address's metadata, but not to make it the default", async () => {
        const ada = buyer("ada-unpins@oja.test")
        const home = await save(ada, ADDRESS)

        const unpinned = await status(api.post(`/store/customers/me/addresses/${home}`, { ...ADDRESS, metadata: {} }, ada))
        await api.post(`/store/customers/me/addresses/${home}`, { is_default_shipping: true }, ada)

        expect(unpinned).toBe(400)
        expect(await addresses(ada)).toEqual([
          expect.objectContaining({ is_default_shipping: true, metadata: ADDRESS.metadata }),
        ])
      })
    })
  },
})
