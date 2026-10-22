import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SellerRole } from "@mercurjs/types"
import { formatMoney } from "@oja/domain"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { followUpRefundAccounts } from "../../src/lib/refund-accounts"
import { retryOwedRefunds } from "../../src/lib/refund-retry"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { adminHeaders, vendorHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, ORDER_TOTALS, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { BEST_VALUE_FEE, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(31000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(32000 + (process.pid % 1000))
const expo = fakeExpoPush(33000 + (process.pid % 1000))
const resend = fakeResend(34000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
process.env.RESEND_API_KEY = resend.apiKey
process.env.RESEND_API_URL = resend.apiUrl
process.env.RESEND_FROM = "Oja <orders@oja.test>"

const ADA = "ada@oja.test"
const MINUTE = 60 * 1000
/** The grocery's share of Ada's checkout: two bags of rice and its delivery fee. */
const GROCERY_SHARE = ORDER_TOTALS.get(GROCERY)!

// Owners, managers and Oja's operators cancel an accepted order and refund all that is left of
// its share of the checkout (#17).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const response = (request: Promise<{ status: number; data: any }>) =>
      request.then(
        ({ status, data }) => ({ status, data }),
        (e: any) => ({ status: e.response?.status as number, data: e.response?.data })
      )
    const status = async (request: Promise<{ status: number; data: any }>) => (await response(request)).status

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      paystack.refuseRefunds(undefined)
      expo.reset()
      resend.reset()
      await buyer.load()
    })

    const staff = async (shop: Shop) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await buyer.sellerId(shop))
    const admin = () => adminHeaders(getContainer(), api)
    const post = async (path: string, body = {}, shop: Shop = GROCERY) =>
      api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const get = async (path: string, shop: Shop = GROCERY) => (await api.get(`/vendor/orders/${path}`, await buyer.owner(shop))).data
    const cancel = async (orderId: string, body: Record<string, unknown> = { reason: "items_unavailable" }, shop: Shop = GROCERY) =>
      post(`${orderId}/cancel`, body, shop)
    const shopOrder = async (orderId: string, shop: Shop = GROCERY) => (await get(`${orderId}?fields=+status,+total`, shop)).order
    const pickList = async (orderId: string) => (await get(`${orderId}/pick-list`)).pick_list

    /** Ada's paid checkout, and each shop's order of it. */
    const paidOrders = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      return {
        cartId,
        reference,
        grocery: await buyer.shopOrderId(GROCERY, cartId),
        gadgets: await buyer.shopOrderId(GADGETS, cartId),
      }
    }
    /** The grocery's order accepted and being picked; returns its pick list. */
    const startPicking = async (orderId: string) => {
      await post(`${orderId}/accept`)
      await post(`${orderId}/start-picking`)
      return pickList(orderId)
    }
    const reservationsOf = async (orderId: string) => {
      const { data } = await buyer.query().graph({ entity: "order", fields: ["items.id"], filters: { id: orderId } })
      const lineItemIds = (data[0].items ?? []).map((item: any) => item.id)
      return getContainer().resolve(Modules.INVENTORY).listReservationItems({ line_item_id: lineItemIds })
    }
    /** The order as Ada sees it in her order history. */
    const adasOrder = async (cartId: string, orderId: string) => {
      const groupId = await buyer.orderGroupOf(cartId)
      const { order_group } = (await api.get(`/store/order-history/${groupId}`, buyer.ada())).data
      return order_group.orders.find((o: any) => o.id === orderId)
    }

    describe("a shop cancelling an accepted order", () => {
      it("shows what it would refund: all of the order's share, items and delivery", async () => {
        const { grocery } = await paidOrders()
        await startPicking(grocery)

        expect((await get(`${grocery}/cancel`)).cancel).toEqual({
          allowed: true,
          refund_amount: GROCERY_SHARE,
          currency_code: "ngn",
        })
      })

      it("cancels it, refunds its whole share and returns its stock; the other shop's order keeps its payment", async () => {
        const { cartId, reference, grocery, gadgets } = await paidOrders()
        const [rice] = (await startPicking(grocery)).lines
        expect(await reservationsOf(grocery)).toHaveLength(1)

        const { data } = await cancel(grocery, { reason: "cannot_fulfil" })

        expect(data.fulfilment).toMatchObject({
          state: "cancelled",
          cancellation: { by: "seller", reason: "cannot_fulfil", note: null, at: expect.any(String) },
          timeline: [],
        })
        expect(data.refund_amount).toBe(GROCERY_SHARE)
        expect(data.refund).toEqual({ amount: GROCERY_SHARE, status: "pending" })
        // One partial refund on the shared Paystack transaction, of the grocery's share alone (kobo).
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([GROCERY_SHARE * 100])
        expect((await adasOrder(cartId, grocery)).refunds).toEqual([
          { amount: GROCERY_SHARE, status: "pending", lines: [{ item_id: rice.id, quantity: rice.quantity }] },
        ])
        expect(await reservationsOf(grocery)).toEqual([])
        const cancelled = await shopOrder(grocery)
        expect(cancelled.status).toBe("canceled")
        expect(cancelled.fulfilment.state).toBe("cancelled")
        expect((await get(`${grocery}/cancel`)).cancel).toEqual({ allowed: false, refund_amount: 0, currency_code: "ngn" })
        // The shop is paid nothing for it.
        expect((await get(`${grocery}/payout`)).payout).toMatchObject({ amount: 0, commission: 0, state: "not_due" })

        const other = await shopOrder(gadgets, GADGETS)
        expect(other.status).not.toBe("canceled")
        expect(other.fulfilment.state).toBe("new")
        expect(other.payment_collections[0]).toMatchObject({ captured_amount: ORDER_TOTALS.get(GADGETS), refunded_amount: 0 })
      })

      it("refunds only what is left once items were removed and refunded while picking", async () => {
        const { cartId, reference, grocery } = await paidOrders()
        const [rice] = (await startPicking(grocery)).lines
        await post(`${grocery}/pick-list/${rice.id}/unavailable`, { quantity: 1 })
        await post(`${grocery}/remove-unavailable`)

        const { data } = await cancel(grocery)

        expect(data.refund_amount).toBe(RICE.price + BEST_VALUE_FEE)
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100, (RICE.price + BEST_VALUE_FEE) * 100])
        // Each refund names its own units: the bag removed, then the bag left on the order.
        expect((await adasOrder(cartId, grocery)).refunds).toEqual([
          { amount: RICE.price, status: "pending", lines: [{ item_id: rice.id, quantity: 1 }] },
          { amount: RICE.price + BEST_VALUE_FEE, status: "pending", lines: [{ item_id: rice.id, quantity: 1 }] },
        ])
        expect(await reservationsOf(grocery)).toEqual([])
      })

      it("cancels a packed order whose courier label isn't booked, but not once it is", async () => {
        const first = await paidOrders()
        const second = await paidOrders()
        for (const { grocery } of [first, second]) {
          const [rice] = (await startPicking(grocery)).lines
          await post(`${grocery}/pick-list/${rice.id}`, { picked: rice.quantity })
          await post(`${grocery}/pack`)
        }
        await post(`${second.grocery}/book-label`)

        expect(await status(cancel(first.grocery))).toBe(200)
        expect(paystack.refundsOf(first.reference).map((r) => r.amount)).toEqual([GROCERY_SHARE * 100])
        expect(await status(cancel(second.grocery))).toBe(400)
        expect((await shopOrder(second.grocery)).fulfilment.state).toBe("label_booked")
        expect(paystack.refundsOf(second.reference)).toEqual([])
      })

      it("is refused for an order not yet accepted, which is rejected instead, and for one already cancelled", async () => {
        const { reference, grocery, gadgets } = await paidOrders()
        await startPicking(grocery)
        await cancel(grocery)

        expect(await status(cancel(gadgets, undefined, GADGETS))).toBe(400)
        expect(await status(cancel(grocery))).toBe(400)
        expect(paystack.refundsOf(reference)).toHaveLength(1)
      })

      it("needs one of the reasons, and a note for any other", async () => {
        const { grocery } = await paidOrders()
        await startPicking(grocery)

        expect(await status(cancel(grocery, {}))).toBe(400)
        expect(await status(cancel(grocery, { reason: "bored" }))).toBe(400)
        expect(await status(cancel(grocery, { reason: "other" }))).toBe(400)
        expect(await status(cancel(grocery, { reason: "other", note: "  " }))).toBe(400)
        expect((await shopOrder(grocery)).fulfilment.state).toBe("picking")

        const { data } = await cancel(grocery, { reason: "other", note: "Our freezer broke down" })
        expect(data.fulfilment.cancellation).toMatchObject({ reason: "other", note: "Our freezer broke down" })
      })

      it("is for owners and managers only: fulfilment staff can't, and no other shop can", async () => {
        const { grocery } = await paidOrders()
        await startPicking(grocery)

        expect(await status(api.post(`/vendor/orders/${grocery}/cancel`, { reason: "buyer_asked" }, await staff(GROCERY)))).toBe(403)
        expect(await status(cancel(grocery, { reason: "buyer_asked" }, GADGETS))).toBe(404)
        expect((await shopOrder(grocery)).fulfilment.state).toBe("picking")

        // A manager: the shop's administration role, without owning it.
        const { data: me } = await api.get(`/vendor/sellers/${await buyer.sellerId(GROCERY)}/members/me`, await staff(GROCERY))
        const { updateMemberRoleWorkflow } = await import("@mercurjs/core/workflows")
        await updateMemberRoleWorkflow(getContainer()).run({
          input: { seller_member_id: me.seller_member.id, role_id: SellerRole.SELLER_ADMINISTRATION },
        })
        try {
          const manager = await staff(GROCERY)
          expect(await status(api.post(`/vendor/orders/${grocery}/cancel`, { reason: "buyer_asked" }, manager))).toBe(200)
        } finally {
          await updateMemberRoleWorkflow(getContainer()).run({
            input: { seller_member_id: me.seller_member.id, role_id: SellerRole.ORDER_MANAGEMENT },
          })
        }
      })
    })

    describe("an order whose every item is unavailable", () => {
      it("offers cancel instead of removing the items", async () => {
        const { reference, grocery } = await paidOrders()
        const [rice] = (await startPicking(grocery)).lines

        const { data } = await post(`${grocery}/pick-list/${rice.id}/unavailable`, { quantity: rice.quantity })

        expect(data.pick_list.progress.allUnavailable).toBe(true)
        const removal = await response(post(`${grocery}/remove-unavailable`))
        expect(removal.status).toBe(400)
        expect(removal.data).toMatchObject({ code: "cancel_instead", message: expect.stringMatching(/cancel/i) })
        expect(paystack.refundsOf(reference)).toEqual([])

        const cancelled = await cancel(grocery)
        expect(cancelled.data.fulfilment.state).toBe("cancelled")
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([GROCERY_SHARE * 100])
      })
    })

    describe("a refund Paystack refuses", () => {
      it("leaves the order cancelled and owing its share, and the retry job refunds it", async () => {
        const { cartId, reference, grocery } = await paidOrders()
        const [rice] = (await startPicking(grocery)).lines
        paystack.refuseRefunds("Insufficient balance")

        const { data } = await cancel(grocery)

        expect(data).toMatchObject({ refund_amount: GROCERY_SHARE, refund: null })
        expect(data.fulfilment.state).toBe("cancelled")
        expect(paystack.refundsOf(reference)).toEqual([])
        const owedRefunds = async () => (await api.get("/admin/owed-refunds", await admin())).data.owed_refunds as any[]
        expect((await owedRefunds()).find((o) => o.order_id === grocery)).toMatchObject({
          amount: GROCERY_SHARE,
          attempts: 1,
          last_error: "Insufficient balance",
          state: "retrying",
        })
        // Still nothing for the shop while the buyer is owed it.
        expect((await get(`${grocery}/payout`)).payout).toMatchObject({ amount: 0 })

        paystack.refuseRefunds(undefined)
        await retryOwedRefunds(getContainer(), new Date(Date.now() + 6 * MINUTE))

        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([GROCERY_SHARE * 100])
        expect((await owedRefunds()).find((o) => o.order_id === grocery)).toBeUndefined()
        // The retry is for the lines the refused refund was for.
        expect((await adasOrder(cartId, grocery)).refunds).toEqual([
          { amount: GROCERY_SHARE, status: "pending", lines: [{ item_id: rice.id, quantity: rice.quantity }] },
        ])
      })
    })

    describe("an order already owing its buyer a refund", () => {
      const DAY = 24 * 60 * MINUTE
      const owedRefundOf = async (orderId: string) =>
        ((await api.get("/admin/owed-refunds", await admin())).data.owed_refunds as any[]).find((o) => o.order_id === orderId)
      /** The grocery's order being picked, a bag of rice taken off it as unavailable (its refund then made, or refused). */
      const riceRemoved = async () => {
        const paid = await paidOrders()
        const [rice] = (await startPicking(paid.grocery)).lines
        await post(`${paid.grocery}/pick-list/${rice.id}/unavailable`, { quantity: 1 })
        await post(`${paid.grocery}/remove-unavailable`)
        return paid
      }
      const LEFT = GROCERY_SHARE - RICE.price
      /**
       * The rice's refund needs Ada's bank account, which she doesn't give in 7 days: it is handed
       * to Oja's team, who owe it to her by hand.
       */
      const riceRefundHandedOver = async () => {
        const paid = await riceRemoved()
        const [riceRefund] = paystack.refundsOf(paid.reference)
        paystack.settleRefund(riceRefund!.id, "needs-attention")
        await buyer.postWebhook(paystack.refundEvent(riceRefund!.id))
        const row = await eventually(
          async () => (await fulfilmentService(getContainer()).listOrderRefunds({ paystack_refund_id: String(riceRefund!.id) }))[0],
          (r) => r?.status === "needs-attention"
        )
        await followUpRefundAccounts(getContainer(), new Date(new Date(row!.needs_attention_at!).getTime() + 7 * DAY + MINUTE))
        return paid
      }

      it("shows, refunds and tells Ada of what is left once Oja's team settled the rice's refund by hand", async () => {
        const device = pushToken()
        await api.post("/store/push-tokens", { token: device }, buyer.ada())
        paystack.refuseRefunds("Insufficient balance")
        const { reference, grocery } = await riceRemoved()
        expect(await owedRefundOf(grocery)).toMatchObject({ amount: RICE.price, attempts: 1 })
        await api.post(`/admin/owed-refunds/${grocery}/settle`, { method: "bank_transfer", note: "Sent to her GTB account" }, await admin())
        paystack.refuseRefunds(undefined)

        expect((await get(`${grocery}/cancel`)).cancel).toMatchObject({ refund_amount: LEFT })
        const { data } = await cancel(grocery)

        expect(data).toMatchObject({ refund_amount: LEFT, refund: { amount: LEFT, status: "pending" } })
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([LEFT * 100])
        expect(await owedRefundOf(grocery)).toBeUndefined()
        const { display_id } = await shopOrder(grocery)
        const [push] = await eventually(
          async () => expo.sentTo(device).filter((m: any) => m.title === `Order #${display_id} cancelled`),
          (sent) => sent.length > 0
        )
        expect(push.body).toContain(`You'll be refunded ${formatMoney(LEFT, "ngn")}.`)
      })

      it("still refunds the rest through Paystack when the rice's refund was handed to Oja's team (#13)", async () => {
        const { reference, grocery } = await riceRefundHandedOver()
        expect(await owedRefundOf(grocery)).toMatchObject({ amount: RICE.price, by_hand: RICE.price, state: "manual" })

        expect((await get(`${grocery}/cancel`)).cancel).toMatchObject({ refund_amount: LEFT })
        const { data } = await cancel(grocery)

        expect(data).toMatchObject({ refund_amount: LEFT, refund: { amount: LEFT, status: "pending" } })
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100, LEFT * 100])
        // The rice's refund is still the team's to send; nothing else is owed.
        expect(await owedRefundOf(grocery)).toMatchObject({ amount: RICE.price, by_hand: RICE.price, state: "manual" })
      })

      it("retries the rest when Paystack refuses it, leaving only the handed-over refund to Oja's team", async () => {
        const { reference, grocery } = await riceRefundHandedOver()
        paystack.refuseRefunds("Insufficient balance")

        const { data } = await cancel(grocery)

        expect(data).toMatchObject({ refund_amount: LEFT, refund: null })
        expect(await owedRefundOf(grocery)).toMatchObject({
          amount: GROCERY_SHARE,
          by_hand: RICE.price,
          attempts: 1,
          state: "retrying",
        })
        paystack.refuseRefunds(undefined)
        await retryOwedRefunds(getContainer(), new Date(Date.now() + 6 * MINUTE))
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100, LEFT * 100])
      })
    })

    describe("Oja's operators", () => {
      it("see what cancelling would refund, and cancel an order from the admin, with the reason", async () => {
        const { reference, grocery } = await paidOrders()
        await startPicking(grocery)
        const headers = await admin()

        expect((await api.get(`/admin/orders/${grocery}/cancel`, headers)).data.cancel).toEqual({
          allowed: true,
          refund_amount: GROCERY_SHARE,
          currency_code: "ngn",
        })
        const { data } = await api.post(`/admin/orders/${grocery}/cancel`, { reason: "other", note: "Shop closed for good" }, headers)

        expect(data.fulfilment).toMatchObject({
          state: "cancelled",
          cancellation: { by: "operator", reason: "other", note: "Shop closed for good" },
        })
        expect(data).toMatchObject({ refund_amount: GROCERY_SHARE, refund: { amount: GROCERY_SHARE, status: "pending" } })
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([GROCERY_SHARE * 100])
        expect(await reservationsOf(grocery)).toEqual([])
      })

      it("can't cancel without a reason, nor an order its shop hasn't accepted", async () => {
        const { grocery } = await paidOrders()
        const headers = await admin()

        expect(await status(api.post(`/admin/orders/${grocery}/cancel`, {}, headers))).toBe(400)
        // New: the shop accepts or rejects it first.
        expect(await status(api.post(`/admin/orders/${grocery}/cancel`, { reason: "buyer_asked" }, headers))).toBe(400)
      })

      it("is the admin's alone", async () => {
        const { grocery } = await paidOrders()
        await startPicking(grocery)

        expect(await status(api.post(`/admin/orders/${grocery}/cancel`, { reason: "buyer_asked" }, await buyer.owner(GROCERY)))).toBe(401)
        expect((await shopOrder(grocery)).fulfilment.state).toBe("picking")
      })
    })

    describe("Ada", () => {
      it("is told by push and email why her order was cancelled and what she is refunded", async () => {
        const device = pushToken()
        await api.post("/store/push-tokens", { token: device }, buyer.ada())
        const { grocery } = await paidOrders()
        await startPicking(grocery)

        await cancel(grocery, { reason: "items_unavailable" })

        const { display_id } = await shopOrder(grocery)
        const refund = formatMoney(GROCERY_SHARE, "ngn")
        const [push] = await eventually(
          async () => expo.sentTo(device).filter((m: any) => m.title === `Order #${display_id} cancelled`),
          (sent) => sent.length > 0
        )
        expect(push).toMatchObject({
          body: `${GROCERY.name} cancelled your order: Items unavailable. You'll be refunded ${refund}.`,
          data: { order_id: grocery },
        })
        const [email] = await eventually(
          async () => resend.sentTo(ADA).filter((e) => e.subject.includes("cancelled")),
          (sent) => sent.length > 0
        )
        expect(email.subject).toContain(`#${display_id}`)
        expect(email.html).toContain("Items unavailable")
        expect(email.html).toContain(refund)
      })

      it("sees the cancelled order, why, and its refund", async () => {
        const { cartId, grocery, gadgets } = await paidOrders()
        await startPicking(grocery)
        await cancel(grocery, { reason: "buyer_asked" })

        const order = await adasOrder(cartId, grocery)

        expect(order.fulfilment).toMatchObject({
          state: "cancelled",
          cancellation: { by: "seller", reason: "buyer_asked", note: null },
        })
        expect(order.refund).toEqual({ amount: GROCERY_SHARE, status: "pending" })
        expect(order.owed_refund).toBeNull()
        expect((await adasOrder(cartId, gadgets)).fulfilment).toMatchObject({ state: "new", cancellation: null })
      })
    })

    describe("a promo code used across the checkout", () => {
      let codes = 0
      /** An operator's 10% code on the items, which counts its uses (a usage limit is set). */
      const operatorCode = async () => {
        const code = `CANCEL${process.pid}X${++codes}`
        const { data } = await api.post(
          "/admin/promotions",
          {
            code,
            type: "standard",
            status: "active",
            limit: 10,
            is_tax_inclusive: true,
            application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10 },
          },
          await admin()
        )
        const promotions = getContainer().resolve(Modules.PROMOTION)
        return {
          code,
          uses: async () => Number((await promotions.retrievePromotion(data.promotion.id)).used ?? 0),
          /** Another buyer's checkout used it too. */
          usedByAnother: () => promotions.registerUsage([{ code, amount: 0 }], { customer_id: null, customer_email: "eve@oja.test" }),
        }
      }
      const pay = async (cartId: string) => {
        await buyer.prepare(cartId)
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        await buyer.postWebhook(paystack.chargeSuccess(reference))
        await buyer.orderGroupOf(cartId)
        await buyer.capturedWithin(cartId)
      }
      /**
       * Ada applies the code to her cart and pays for the grocery's items on their own, in a shop
       * cart sharing the code with the rest of her cart; she can then pay for the rest.
       */
      const shopCartPaidWithCode = async () => {
        const promotion = await operatorCode()
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        await api.post(`/store/carts/${cartId}/checkout/promo-codes`, { code: promotion.code }, buyer.ada())
        const { data } = await api.post(`/store/carts/${cartId}/shop-cart`, { seller_id: await buyer.sellerId(GROCERY) }, buyer.ada())
        const shopCartId = data.cart.id as string
        await pay(shopCartId)
        return {
          ...promotion,
          grocery: await buyer.shopOrderId(GROCERY, shopCartId),
          /** Pays for the rest; returns the gadget shop's order. */
          payRest: async () => {
            await pay(cartId)
            return buyer.shopOrderId(GADGETS, cartId)
          },
        }
      }
      /** Both checkouts paid, counting the code's one use. */
      const paidInTwoWithCode = async () => {
        const { payRest, ...paid } = await shopCartPaidWithCode()
        return { ...paid, gadgets: await payRest() }
      }
      /** Ada pays for her cart with an operator's 10% code on both shops' items; returns its use count and each shop's order. */
      const paidWithCode = async () => {
        const { code, uses } = await operatorCode()
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        await api.post(`/store/carts/${cartId}/checkout/promo-codes`, { code }, buyer.ada())
        await pay(cartId)
        return {
          uses,
          grocery: await buyer.shopOrderId(GROCERY, cartId),
          gadgets: await buyer.shopOrderId(GADGETS, cartId),
        }
      }

      it("gets its use back only once every order that used it is cancelled", async () => {
        const { uses, grocery, gadgets } = await paidWithCode()
        expect(await uses()).toBe(1)

        await startPicking(grocery)
        await cancel(grocery)
        expect(await uses()).toBe(1)

        await post(`${gadgets}/accept`, {}, GADGETS)
        await cancel(gadgets, { reason: "buyer_asked" }, GADGETS)
        expect(await uses()).toBe(0)
      })

      it("gets it back too when the last order that used it is rejected", async () => {
        const { uses, grocery, gadgets } = await paidWithCode()
        await startPicking(grocery)
        await cancel(grocery)

        await post(`${gadgets}/reject`, { reason: "Out of stock" }, GADGETS)

        expect(await uses()).toBe(0)
      })

      describe("shared by a cart and its shop cart, paid apart", () => {
        it("keeps its use while the other checkout still has an order it discounted", async () => {
          const { uses, grocery, gadgets } = await paidInTwoWithCode()
          expect(await uses()).toBe(1)

          await startPicking(grocery)
          await cancel(grocery)
          expect(await uses()).toBe(1)

          await post(`${gadgets}/accept`, {}, GADGETS)
          await cancel(gadgets, { reason: "buyer_asked" }, GADGETS)
          expect(await uses()).toBe(0)
        })

        it("gets it back once when both checkouts' last orders are cancelled at the same time", async () => {
          const { uses, usedByAnother, grocery, gadgets } = await paidInTwoWithCode()
          await usedByAnother()
          expect(await uses()).toBe(2)
          await post(`${grocery}/accept`)
          await post(`${gadgets}/accept`, {}, GADGETS)

          const cancelled = await Promise.all([
            status(cancel(grocery)),
            status(cancel(gadgets, { reason: "buyer_asked" }, GADGETS)),
          ])

          expect(cancelled).toEqual([200, 200])
          expect(await uses()).toBe(1)
        })

        it("gets it back once the shop cart's order is cancelled before the rest is paid for, which then counts its own use", async () => {
          const { uses, usedByAnother, grocery, payRest } = await shopCartPaidWithCode()
          await usedByAnother()
          expect(await uses()).toBe(2)

          await post(`${grocery}/accept`)
          await cancel(grocery)
          expect(await uses()).toBe(1)

          await payRest()
          expect(await uses()).toBe(2)
        })
      })
    })
  },
})
