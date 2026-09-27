import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import { SellerRole } from "@mercurjs/types"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const [grocery, fashion] = SEED_SELLERS

    // Seeded once; the runner restores this snapshot before every test.
    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    const sellerId = async (shop: (typeof SEED_SELLERS)[number]) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return seller.id as string
    }

    /** Request config for a seeded person acting for a shop. */
    const signedIn = async (email: string, shop: (typeof SEED_SELLERS)[number]) =>
      vendorHeaders(api, email, SEED_PASSWORD, await sellerId(shop))

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    describe("inviting staff", () => {
      /** The invite email sent to an address, once the event's subscriber has run. */
      const inviteEmail = async (to: string) => {
        const notifications = getContainer().resolve(Modules.NOTIFICATION)
        for (let attempt = 0; attempt < 50; attempt++) {
          const [sent] = await notifications.listNotifications({ to, channel: "email" })
          if (sent) return sent
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error(`no email was sent to ${to}`)
      }

      it("emails the invitee a link that signs them up as fulfilment staff", async () => {
        const owner = await signedIn(grocery.owner.email, grocery)
        await api.post(
          `/vendor/sellers/${await sellerId(grocery)}/members`,
          { email: "ada@oja.test", role_id: SellerRole.ORDER_MANAGEMENT },
          owner
        )

        const email = await inviteEmail("ada@oja.test")
        expect(email.template).toBe("member-invite")
        expect(email.data).toMatchObject({ seller_name: grocery.name, role: "Order Management" })
        const link = new URL(email.data!.invite_url as string)
        expect(`${link.origin}${link.pathname}`).toBe(`${process.env.MERCUR_VENDOR_URL}/invite`)

        // What the vendor panel's invite page does with the link.
        const { data: registered } = await api.post("/auth/member/emailpass/register", {
          email: "ada@oja.test",
          password: "ada-password",
        })
        await api.post(
          "/vendor/members/invites/accept",
          { invite_token: link.searchParams.get("token"), first_name: "Ada", last_name: "Obi" },
          { headers: { authorization: `Bearer ${registered.token}` } }
        )

        const ada = await vendorHeaders(api, "ada@oja.test", "ada-password", await sellerId(grocery))
        const { data: me } = await api.get(`/vendor/sellers/${await sellerId(grocery)}/members/me`, ada)
        expect(me.seller_member.rbac_role.id).toBe(SellerRole.ORDER_MANAGEMENT)
        expect(await status(api.get("/vendor/orders", ada))).toBe(200)
        expect(await status(api.get("/vendor/payouts", ada))).toBe(403)
      })
    })

    describe("fulfilment staff", () => {
      it("can work orders but not payouts, offers or pricing", async () => {
        const staff = await signedIn(grocery.staff.email, grocery)
        const { data: offers } = await api.get("/vendor/offers", staff)
        const offerId = offers.offers[0].id

        expect(await status(api.get("/vendor/orders", staff))).toBe(200)

        expect(await status(api.get("/vendor/payouts", staff))).toBe(403)
        expect(await status(api.get("/vendor/payout-accounts", staff))).toBe(403)
        expect(await status(api.post("/vendor/offers", {}, staff))).toBe(403)
        expect(await status(api.post(`/vendor/offers/${offerId}`, { prices: [] }, staff))).toBe(403)
        expect(await status(api.delete(`/vendor/offers/${offerId}`, staff))).toBe(403)
        expect(await status(api.get("/vendor/price-lists", staff))).toBe(403)
        expect(await status(api.post("/vendor/price-lists", {}, staff))).toBe(403)
      })

      it("is refused only what the shop's owner may do", async () => {
        const owner = await signedIn(grocery.owner.email, grocery)
        expect(await status(api.get("/vendor/payouts", owner))).toBe(200)
        expect(await status(api.get("/vendor/price-lists", owner))).toBe(200)
      })
    })

    describe("a member of two shops", () => {
      /** An order placed with the shop, as checkout records it: the order linked to its seller. */
      const orderWith = async (shop: (typeof SEED_SELLERS)[number], title: string) => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: [region] } = await query.graph({ entity: "region", fields: ["id"], filters: { currency_code: "ngn" } })
        const { result: order } = await createOrderWorkflow(container).run({
          input: {
            region_id: region.id,
            email: "buyer@oja.test",
            currency_code: "ngn",
            items: [{ title, quantity: 1, unit_price: 1500 }],
          },
        })
        await container.resolve(ContainerRegistrationKeys.LINK).create({
          [Modules.ORDER]: { order_id: order.id },
          seller: { seller_id: await sellerId(shop) },
        })
        return order.id
      }

      /** The grocery shop's staff member joins the fashion shop through its owner's invite. */
      const joinFashion = async () => {
        const fashionOwner = await signedIn(fashion.owner.email, fashion)
        const { data } = await api.post(
          `/vendor/sellers/${await sellerId(fashion)}/members`,
          { email: grocery.staff.email, role_id: SellerRole.ORDER_MANAGEMENT },
          fashionOwner
        )
        await api.post("/vendor/members/invites/accept", { invite_token: data.member_invite.token }, await staffLogin())
      }

      /** The grocery staff member's login, before any shop is chosen. */
      const staffLogin = async () => {
        const { data } = await api.post("/auth/member/emailpass", { email: grocery.staff.email, password: SEED_PASSWORD })
        return { headers: { authorization: `Bearer ${data.token}` } }
      }

      const orderIds = async (headers: { headers: Record<string, string> }) => {
        const { data } = await api.get("/vendor/orders", headers)
        return (data.orders as { id: string }[]).map((o) => o.id)
      }

      it("lists both shops and sees each shop's own orders when it switches", async () => {
        const groceryOrder = await orderWith(grocery, "Ofada Rice 5kg")
        const fashionOrder = await orderWith(fashion, "Adire Kaftan")
        await joinFashion()

        const { data } = await api.get("/vendor/sellers", await staffLogin())
        expect((data.seller_members as { seller_id: string }[]).map((m) => m.seller_id).sort()).toEqual(
          [await sellerId(grocery), await sellerId(fashion)].sort()
        )

        expect(await orderIds(await signedIn(grocery.staff.email, grocery))).toEqual([groceryOrder])
        expect(await orderIds(await signedIn(grocery.staff.email, fashion))).toEqual([fashionOrder])
      })

      it("keeps each shop's role: fulfilment in both, so no payouts in either", async () => {
        await joinFashion()
        const inFashion = await signedIn(grocery.staff.email, fashion)
        expect(await status(api.get("/vendor/orders", inFashion))).toBe(200)
        expect(await status(api.get("/vendor/payouts", inFashion))).toBe(403)
      })

      // The app keeps acting for its saved shop; once the member is removed from it,
      // the app must tell that apart from an expired sign-in and find the member's shops.
      it("once removed from a shop, is refused it without being signed out and still lists its other shop", async () => {
        await joinFashion()
        const fashionOwner = await signedIn(fashion.owner.email, fashion)
        const { data } = await api.get(`/vendor/sellers/${await sellerId(fashion)}/members`, fashionOwner)
        const membership = (data.seller_members as { id: string; member: { email: string } }[]).find(
          (m) => m.member.email === grocery.staff.email
        )!
        await api.delete(`/vendor/sellers/${await sellerId(fashion)}/members/${membership.id}`, fashionOwner)

        const stale = await signedIn(grocery.staff.email, fashion)
        const refused = await api.get("/vendor/orders", stale).catch((e: any) => e.response)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toBe("You are not a member of this seller account")
        const { data: shops } = await api.get("/vendor/sellers", stale)
        expect((shops.seller_members as { seller_id: string }[]).map((m) => m.seller_id)).toEqual([
          await sellerId(grocery),
        ])
      })
    })

    describe("a shop it doesn't belong to", () => {
      it("is refused", async () => {
        const staff = await signedIn(grocery.staff.email, fashion)
        expect(await status(api.get("/vendor/orders", staff))).not.toBe(200)
      })
    })
  },
})
