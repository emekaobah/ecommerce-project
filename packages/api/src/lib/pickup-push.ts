import { pickupReadyPush, PRODUCT_NAME } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED } from "../modules/expo-push/expo-api"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { collectionPlacesOf } from "./collection-point"
import { errorMessage } from "./errors"
import { forgetPushDevices } from "./push-receipts"

// The buyer's push when their pickup order is Ready for pickup (#12), on the push channel
// (ADR 0008): the code is in the app, and where and when to come. Each device is told once.

type Scope = Pick<MedusaContainer, "resolve">

type ReadyOrder = {
  id: string
  display_id: number
  customer_id: string | null
  seller?: { id: string; name: string } | null
  order_group?: { id: string } | null
}

/** Pushes every device of the order's buyer that the order is ready to collect. */
export async function pushPickupReady(scope: Scope, orderId: string): Promise<void> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "customer_id", "seller.id", "seller.name", "order_group.id"],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as ReadyOrder | undefined
  if (!order?.customer_id || !order.seller) return
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "customer", actor_id: order.customer_id })
  if (!tokens.length) return
  // A shop keeps its collection point once set, so a pickup order's shop has one.
  const place = (await collectionPlacesOf(scope, [order.seller.id])).get(order.seller.id)
  if (!place) return
  const { title, body } = pickupReadyPush({
    displayId: order.display_id,
    shopName: order.seller.name,
    address: place.address,
    weekly: place.weekly,
    appName: PRODUCT_NAME,
  })
  const devices = tokens.map((t) => t.token)
  const notifications = scope.resolve(Modules.NOTIFICATION)
  // One device a call, so a refusal is known to be that device's.
  const sent = await Promise.allSettled(
    devices.map((to) =>
      notifications.createNotifications({
        to,
        channel: PUSH_CHANNEL,
        template: "buyer-pickup-ready",
        content: { subject: title, text: body },
        data: { url: `/order/${order.order_group?.id ?? ""}`, order_id: order.id },
        idempotency_key: ["pickup_ready", order.id, to].join(":"),
      })
    )
  )
  const gone: string[] = []
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  sent.forEach((result, i) => {
    if (result.status === "fulfilled") return
    const reason = errorMessage(result.reason)
    if (reason.includes(DEVICE_NOT_REGISTERED)) gone.push(devices[i])
    else logger.warn(`Pushing pickup_ready for order ${orderId} failed: ${reason}`)
  })
  await forgetPushDevices(scope, gone)
}
