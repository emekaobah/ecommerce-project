import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { ADDRESS, PIN } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it listens.
const shipbubble = fakeShipbubble(57000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

/** Ada's office, pinned on Adeola Odeku Street, with no landmark. */
const OFFICE = {
  ...ADDRESS,
  address_1: "12 Adeola Odeku Street",
  address_2: null,
  metadata: { latitude: 6.4302, longitude: 3.4178 },
}

/** Shipbubble's address code for an address validated by this pin; throws if it never was. */
const codeAt = (pin: { latitude: number; longitude: number }) => {
  const code = shipbubble.codeOf(`${pin.latitude},${pin.longitude}`)
  if (code === undefined) throw new Error(`Shipbubble never validated an address at ${pin.latitude},${pin.longitude}`)
  return code
}

// A buyer's saved delivery addresses (#18) are Medusa's customer addresses, through the store's
// own routes; the landmark, the pin she confirmed and Shipbubble's address code live in their
// metadata (ADR 0002).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>

    beforeAll(async () => {
      await shipbubble.start()
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    afterAll(() => shipbubble.stop())

    beforeEach(async () => {
      shipbubble.reset()
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
    const validationsFor = (email: string) => shipbubble.validations().filter((v) => v.email === email)
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
          metadata: { landmark: ADDRESS.metadata.landmark, ...PIN, shipbubble_address_code: codeAt(PIN) },
        }),
      ])
    })

    describe("validated with Shipbubble when saved", () => {
      it("sends the pin with the address text, and keeps Shipbubble's address code", async () => {
        const ada = buyer("ada-validated@oja.test")

        await save(ada, ADDRESS)

        expect(validationsFor("ada-validated@oja.test")).toEqual([
          {
            name: "Ada Obi",
            email: "ada-validated@oja.test",
            phone: ADDRESS.phone,
            address: "3 Akin Adesola Street, Flat 4, Eti-Osa, Lagos, Nigeria",
            ...PIN,
          },
        ])
        expect((await addresses(ada))[0].metadata.shipbubble_address_code).toBe(codeAt(PIN))
      })

      describe("an address saved without a name (#101)", () => {
        const nameless = { ...ADDRESS, first_name: null, last_name: null }

        it("is validated in the name on the buyer's account", async () => {
          const email = "ada-account-name@oja.test"
          const ada = {
            headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email, first_name: "Ada", last_name: "Obi" })}` },
          }

          await save(ada, nameless)

          expect(validationsFor(email)).toEqual([expect.objectContaining({ name: "Ada Obi" })])
        })

        it("saves for a buyer whose account has no name either, validated in their email", async () => {
          const email = "nameless@oja.test"

          await save(buyer(email), nameless)

          expect(validationsFor(email)).toEqual([expect.objectContaining({ name: email })])
          expect(await addresses(buyer(email))).toEqual([
            expect.objectContaining({ first_name: null, last_name: null, address_1: ADDRESS.address_1 }),
          ])
        })
      })

      it("refuses an address Shipbubble can't place, and saves nothing", async () => {
        const ada = buyer("ada-unplaced@oja.test")
        shipbubble.rejectAddresses((v) => v.email === "ada-unplaced@oja.test")

        const res = await api.post("/store/customers/me/addresses", ADDRESS, ada).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/couldn't find this address for delivery/)
        expect(await addresses(ada)).toEqual([])
      })

      it("never keeps an address code the app sent", async () => {
        const ada = buyer("ada-sends-code@oja.test")
        const home = await save(ada, { ...ADDRESS, metadata: { ...ADDRESS.metadata, shipbubble_address_code: 1 } })
        const moved = { latitude: 6.4285, longitude: 3.4222 }

        const saved = (await addresses(ada))[0].metadata.shipbubble_address_code
        await api.post(`/store/customers/me/addresses/${home}`, { metadata: { ...moved, shipbubble_address_code: 1 } }, ada)

        expect(saved).toBe(codeAt(PIN))
        expect((await addresses(ada))[0].metadata.shipbubble_address_code).toBe(codeAt(moved))
      })

      it("validates an edit again: the edited address gets its own code", async () => {
        const ada = buyer("ada-moves@oja.test")
        const home = await save(ada, ADDRESS)
        const moved = { latitude: 6.4285, longitude: 3.4222 }

        await api.post(`/store/customers/me/addresses/${home}`, { address_2: "Flat 5", metadata: moved }, ada)

        const [edit] = validationsFor("ada-moves@oja.test").slice(1)
        expect(edit).toMatchObject({ address: "3 Akin Adesola Street, Flat 5, Eti-Osa, Lagos, Nigeria", ...moved })
        expect((await addresses(ada))[0].metadata).toEqual({
          landmark: ADDRESS.metadata.landmark,
          ...moved,
          shipbubble_address_code: codeAt(moved),
        })
      })

      it("refuses an edit Shipbubble can't place, and keeps the address as it was", async () => {
        const ada = buyer("ada-bad-edit@oja.test")
        const home = await save(ada, ADDRESS)
        const before = await addresses(ada)
        shipbubble.rejectAddresses((v) => v.email === "ada-bad-edit@oja.test")

        const res = await api
          .post(`/store/customers/me/addresses/${home}`, { address_1: "Nowhere", metadata: { latitude: 0, longitude: 0 } }, ada)
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/couldn't find this address for delivery/)
        expect(await addresses(ada)).toEqual(before)
      })

      it("asks Shipbubble nothing to make an address the default", async () => {
        const ada = buyer("ada-defaults@oja.test")
        await save(ada, ADDRESS)
        const office = await save(ada, OFFICE)

        await api.post(`/store/customers/me/addresses/${office}`, { is_default_shipping: true }, ada)

        expect(validationsFor("ada-defaults@oja.test")).toHaveLength(2)
      })
    })

    it("has one default: making another the default unsets the first", async () => {
      const ada = buyer("ada-default@oja.test")
      const home = await save(ada, { ...ADDRESS, is_default_shipping: true })
      const office = await save(ada, OFFICE)

      await api.post(`/store/customers/me/addresses/${office}`, { is_default_shipping: true }, ada)

      const defaults = Object.fromEntries((await addresses(ada)).map((a) => [a.id, a.is_default_shipping]))
      expect(defaults).toEqual({ [home]: false, [office]: true })
    })

    // The Account screen's "2 saved · 14 Bode Thomas St is default" (#73).
    describe("in the account summary", () => {
      const summary = async (as: object) => (await api.get("/store/customers/me/summary", as)).data.summary

      it("counts the buyer's addresses and names the default by its street", async () => {
        const ada = buyer("ada-summary@oja.test")
        await save(ada, ADDRESS)
        await save(ada, { ...OFFICE, is_default_shipping: true })

        expect((await summary(ada)).addresses).toEqual({ count: 2, default_label: OFFICE.address_1 })
      })

      it("has no default label while none is the default", async () => {
        const ada = buyer("ada-no-default@oja.test")
        const before = (await summary(ada)).addresses
        await save(ada, ADDRESS)

        expect(before).toEqual({ count: 0, default_label: null })
        expect((await summary(ada)).addresses).toEqual({ count: 1, default_label: null })
      })

      it("asks a guest to sign in", async () => {
        expect(await status(api.get("/store/customers/me/summary", { headers }))).toBe(401)
      })
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

      const code = codeAt(moved)
      expect(kept).toEqual({ landmark: ADDRESS.metadata.landmark, ...moved, shipbubble_address_code: code })
      expect((await addresses(ada))[0].metadata).toEqual({ ...moved, shipbubble_address_code: code })
    })

    it("deletes an address", async () => {
      const ada = buyer("ada-deletes@oja.test")
      const home = await save(ada, ADDRESS)
      const office = await save(ada, OFFICE)

      await api.delete(`/store/customers/me/addresses/${home}`, ada)

      expect((await addresses(ada)).map((a) => a.id)).toEqual([office])
    })

    describe("deleting the default", () => {
      const defaults = async (as: object) =>
        Object.fromEntries((await addresses(as)).map((a) => [a.id, a.is_default_shipping]))

      it("makes the most recently added of the rest the default", async () => {
        const ada = buyer("ada-loses-default@oja.test")
        const home = await save(ada, { ...ADDRESS, is_default_shipping: true })
        const office = await save(ada, OFFICE)
        const mums = await save(ada, { ...OFFICE, address_1: "7 Bode Thomas Street" })

        await api.delete(`/store/customers/me/addresses/${home}`, ada)

        expect(await defaults(ada)).toEqual({ [office]: false, [mums]: true })
      })

      it("leaves the default alone when another address goes", async () => {
        const ada = buyer("ada-keeps-default@oja.test")
        const home = await save(ada, { ...ADDRESS, is_default_shipping: true })
        const office = await save(ada, OFFICE)
        const mums = await save(ada, { ...OFFICE, address_1: "7 Bode Thomas Street" })

        await api.delete(`/store/customers/me/addresses/${mums}`, ada)

        expect(await defaults(ada)).toEqual({ [home]: true, [office]: false })
      })

      it("leaves no address behind when it was the only one", async () => {
        const ada = buyer("ada-last-address@oja.test")
        const home = await save(ada, { ...ADDRESS, is_default_shipping: true })

        await api.delete(`/store/customers/me/addresses/${home}`, ada)

        expect(await addresses(ada)).toEqual([])
      })
    })

    it("is the buyer's own: another buyer can neither see nor change it", async () => {
      const ada = buyer("ada-own@oja.test")
      const bola = buyer("bola-own@oja.test")
      const home = await save(ada, ADDRESS)

      expect(await addresses(bola)).toEqual([])
      expect(await status(api.post(`/store/customers/me/addresses/${home}`, OFFICE, bola))).toBe(404)
      expect(await status(api.delete(`/store/customers/me/addresses/${home}`, bola))).toBe(404)
      expect(validationsFor("bola-own@oja.test")).toEqual([])
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
        expect(validationsFor("ada-unpinned@oja.test")).toEqual([])
      })

      it("to change an address's metadata, but not to make it the default", async () => {
        const ada = buyer("ada-unpins@oja.test")
        const home = await save(ada, ADDRESS)

        const unpinned = await status(api.post(`/store/customers/me/addresses/${home}`, { ...ADDRESS, metadata: {} }, ada))
        await api.post(`/store/customers/me/addresses/${home}`, { is_default_shipping: true }, ada)

        expect(unpinned).toBe(400)
        expect(await addresses(ada)).toEqual([
          expect.objectContaining({
            is_default_shipping: true,
            metadata: { ...ADDRESS.metadata, shipbubble_address_code: codeAt(PIN) },
          }),
        ])
      })
    })
  },
})
