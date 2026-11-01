import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { apnsToken, fakeApns } from "../helpers/apns"
import { LIVE_ACTIVITY_PUSH_MODULE, type LiveActivityPushModuleService } from "../../src/modules/live-activity-push"

jest.setTimeout(60 * 1000)

const apns = fakeApns(30000 + (process.pid % 1000), 31000 + (process.pid % 1000))
Object.assign(process.env, apns.env)

// The sender's behaviour is in its unit spec; this is that the backend's config reaches it.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    beforeAll(() => apns.start())
    afterAll(() => apns.stop())

    const sender = () => getContainer().resolve<LiveActivityPushModuleService>(LIVE_ACTIVITY_PUSH_MODULE)

    it("sends from the backend's environment variables, to the token's own host", async () => {
      const token = apnsToken()

      const result = await sender().send({
        event: "update",
        app: "vendor",
        token,
        environment: "production",
        priority: 5,
        content: { factory: "VendorShopActivity", props: { new: 1 } },
      })

      expect(result).toEqual({ status: "sent" })
      expect(apns.sentTo(token)[0]).toMatchObject({
        environment: "production",
        topic: `${apns.env.APNS_VENDOR_BUNDLE_ID}.push-type.liveactivity`,
      })
    })
  },
})
