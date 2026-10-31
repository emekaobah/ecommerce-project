import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { publishPopularSearches } from "../../src/lib/popular-searches"
import { POPULAR_SEARCH_MODULE, type PopularSearchModuleService } from "../../src/modules/popular-search"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

const DAY = 24 * 60 * 60 * 1000

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>
    let regionId: string

    // Seeded once; the runner restores this snapshot before every test.
    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      headers = { "x-publishable-api-key": keys[0].token }
      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      regionId = regions[0].id
    })

    const service = () => getContainer().resolve<PopularSearchModuleService>(POPULAR_SEARCH_MODULE)
    const phone = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    const record = (term: string, phoneId: string, region = regionId) =>
      api.post("/store/searches", { term, region_id: region, phone_id: phoneId }, { headers })
    /** `term` searched from `phones` different phones, `daysAgo` days ago. */
    const searchedFrom = async (term: string, phones: number, daysAgo = 0, firstPhone = 1) => {
      const searched_at = new Date(Date.now() - daysAgo * DAY)
      await service().createSearchRecords(
        Array.from({ length: phones }, (_, i) => ({ term, region_id: regionId, phone_id: phone(firstPhone + i), searched_at }))
      )
    }
    const popular = async (region = regionId) =>
      (await api.get(`/store/popular-searches?region_id=${region}`, { headers })).data.popular_searches as string[]
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    describe("POST /store/searches", () => {
      it("records a used search, normalised, with its region and phone but no buyer", async () => {
        await record("  Ofada   RICE ", phone(1))

        const [saved] = await service().listSearchRecords({})
        expect(saved).toEqual(expect.objectContaining({ term: "ofada rice", region_id: regionId, phone_id: phone(1), searched_at: expect.any(Date) }))
        expect(Object.keys(saved)).not.toEqual(expect.arrayContaining(["customer_id"]))
      })

      it("refuses a blank term, a phone id that isn't one, and a missing region", async () => {
        expect(await status(record("   ", phone(1)))).toBe(400)
        expect(await status(record("rice", "not-a-phone"))).toBe(400)
        expect(
          await status(api.post("/store/searches", { term: "rice", phone_id: phone(1) }, { headers }))
        ).toBe(400)
        expect(await service().listSearchRecords({})).toHaveLength(0)
      })

      it("records nothing for a region that doesn't exist, and refuses an overlong region id", async () => {
        const { data } = await record("rice", phone(1), "reg_madeup")
        expect(data).toEqual({ recorded: false })
        expect(await status(record("rice", phone(1), `reg_${"x".repeat(100)}`))).toBe(400)
        expect(await service().listSearchRecords({})).toHaveLength(0)
      })
    })

    describe("publishPopularSearches", () => {
      it("publishes terms searched from enough phones, most phones first, that still return listings", async () => {
        await searchedFrom("rice", 6)
        await searchedFrom("kaftan", 5)
        await searchedFrom("lantern", 2)
        // Searched often, but never finds anything.
        await searchedFrom("zzqx", 9)

        await publishPopularSearches(getContainer(), { minPhones: 3 })

        expect(await popular()).toEqual(["rice", "kaftan"])
      })

      it("counts one phone searching a term again and again once", async () => {
        await service().createSearchRecords(
          Array.from({ length: 10 }, () => ({ term: "rice", region_id: regionId, phone_id: phone(1), searched_at: new Date() }))
        )
        await searchedFrom("kaftan", 2, 0, 2)

        await publishPopularSearches(getContainer(), { minPhones: 2 })

        expect(await popular()).toEqual(["kaftan"])
      })

      it("counts the last 14 days only, and forgets searches older than 90 days", async () => {
        await searchedFrom("rice", 3, 20)
        await searchedFrom("kaftan", 3, 100)
        await searchedFrom("lantern", 3, 1)

        await publishPopularSearches(getContainer(), { minPhones: 3 })

        expect(await popular()).toEqual(["lantern"])
        const kept = await service().listSearchRecords({}, { select: ["term"] })
        expect(new Set(kept.map((r) => r.term))).toEqual(new Set(["rice", "lantern"]))
      })

      it("forgets a backlog of thousands of searches", async () => {
        await searchedFrom("kaftan", 2500, 100)
        await searchedFrom("lantern", 3, 1)

        await publishPopularSearches(getContainer(), { minPhones: 3 })

        const kept = await service().listSearchRecords({}, { select: ["term"] })
        expect(kept.map((r) => r.term)).toEqual(["lantern", "lantern", "lantern"])
      })

      it("leaves out blocklisted terms, though they find listings", async () => {
        // A shop names a product with a blocklisted word, so searching it finds the listing.
        const products = getContainer().resolve(Modules.PRODUCT)
        const [rice] = await products.listProducts({ title: "Ofada Rice 5kg" })
        await products.updateProducts(rice.id, { title: "Ofada Rice Shit Hot 5kg" })
        await searchedFrom("rice", 3)
        await searchedFrom("shit rice", 4)

        await publishPopularSearches(getContainer(), { minPhones: 3 })

        expect(await popular()).toEqual(["rice"])
      })

      it("keeps the top 8, and replaces the list each run", async () => {
        const terms = ["rice", "ofada", "ofada rice", "kaftan", "adire", "adire kaftan", "lantern", "led", "led lantern"]
        for (const [i, term] of terms.entries()) await searchedFrom(term, 3 + terms.length - i)

        await publishPopularSearches(getContainer(), { minPhones: 3 })
        expect(await popular()).toEqual(terms.slice(0, 8))

        await service().deleteSearchRecords((await service().listSearchRecords({}, { select: ["id"] })).map((r) => r.id))
        await publishPopularSearches(getContainer(), { minPhones: 3 })
        expect(await popular()).toEqual([])
      })

      it("publishes one list when two runs overlap", async () => {
        await searchedFrom("rice", 6)
        await searchedFrom("kaftan", 5)

        const runs = await Promise.allSettled([
          publishPopularSearches(getContainer(), { minPhones: 3 }),
          publishPopularSearches(getContainer(), { minPhones: 3 }),
        ])

        expect(runs.some((r) => r.status === "fulfilled")).toBe(true)
        expect(await popular()).toEqual(["rice", "kaftan"])
      })

      it("holds each rank of a region's list once", async () => {
        await service().createPopularSearches({ region_id: regionId, term: "rice", rank: 0 })
        await expect(service().createPopularSearches({ region_id: regionId, term: "kaftan", rank: 0 })).rejects.toThrow()
      })
    })

    describe("GET /store/popular-searches", () => {
      it("is empty before the job has published a list, and for another region", async () => {
        expect(await popular()).toEqual([])
        await searchedFrom("rice", 3)
        await publishPopularSearches(getContainer(), { minPhones: 3 })

        expect(await popular()).toEqual(["rice"])
        expect(await popular("reg_elsewhere")).toEqual([])
      })

      it("needs a region", async () => {
        expect(await status(api.get("/store/popular-searches", { headers }))).toBe(400)
      })
    })
  },
})
