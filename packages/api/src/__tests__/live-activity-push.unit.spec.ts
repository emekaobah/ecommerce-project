import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apnsToken, fakeApns } from "../../integration-tests/helpers/apns"
import LiveActivityPushModuleService from "../modules/live-activity-push/service"

const apns = fakeApns(25000 + (process.pid % 1000), 26000 + (process.pid % 1000))

const optionsFor = ({ env }: typeof apns) => ({
  keyId: env.APNS_KEY_ID,
  teamId: env.APNS_TEAM_ID,
  key: env.APNS_KEY,
  bundleIds: { buyer: env.APNS_BUYER_BUNDLE_ID, vendor: env.APNS_VENDOR_BUNDLE_ID },
  sandboxUrl: env.APNS_SANDBOX_URL,
  productionUrl: env.APNS_PRODUCTION_URL,
})

const content = { factory: "BuyerOrderActivity", props: { step: 2, shopName: "Mama Put" } }

describe("Live Activity pushes to Apple", () => {
  const logger = { info: jest.fn(), warn: jest.fn() }
  const senderWith = (options: ConstructorParameters<typeof LiveActivityPushModuleService>[1]) => new LiveActivityPushModuleService({ logger } as never, options)
  const configured = () => senderWith(optionsFor(apns))

  beforeAll(() => apns.start())
  afterAll(() => apns.stop())
  afterEach(async () => {
    jest.restoreAllMocks()
    logger.info.mockClear()
    logger.warn.mockClear()
    apns.dropConnections()
    apns.reset()
  })

  describe("what reaches Apple", () => {
    it("starts an activity with the working push-to-start payload from the device test", async () => {
      const token = apnsToken()
      jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000)

      const result = await configured().send({
        event: "start",
        app: "buyer",
        token,
        environment: "sandbox",
        priority: 10,
        content,
        alert: { title: "Order accepted", body: "Mama Put accepted your order", sound: "default" },
      })

      expect(result).toEqual({ status: "sent" })
      const [push] = apns.sentTo(token)
      expect(push).toMatchObject({
        pushType: "liveactivity",
        topic: "com.example.oja.buyer.push-type.liveactivity",
        priority: "10",
      })
      expect(push!.aps).toEqual({
        timestamp: 1_800_000_000,
        event: "start",
        "attributes-type": "LiveActivityAttributes",
        attributes: {},
        "input-push-token": 1,
        alert: { title: "Order accepted", body: "Mama Put accepted your order", sound: "default" },
        "content-state": { name: "BuyerOrderActivity", props: '{"step":2,"shopName":"Mama Put"}' },
      })
    })

    it("updates an activity at the priority asked, with only the content when there's no alert", async () => {
      const token = apnsToken()
      jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000)

      await configured().send({ event: "update", app: "vendor", token, environment: "sandbox", priority: 5, content })

      const [push] = apns.sentTo(token)
      expect(push).toMatchObject({
        pushType: "liveactivity",
        topic: "com.example.oja.vendor.push-type.liveactivity",
        priority: "5",
      })
      expect(push!.aps).toEqual({
        timestamp: 1_800_000_000,
        event: "update",
        "content-state": { name: "BuyerOrderActivity", props: '{"step":2,"shopName":"Mama Put"}' },
      })
    })

    it("carries an alert on an alerting update", async () => {
      const token = apnsToken()

      await configured().send({
        event: "update",
        app: "buyer",
        token,
        environment: "sandbox",
        priority: 10,
        content,
        alert: { title: "Out for delivery", body: "Your order is on its way" },
      })

      const [push] = apns.sentTo(token)
      expect(push!.priority).toBe("10")
      expect(push!.aps.alert).toEqual({ title: "Out for delivery", body: "Your order is on its way" })
    })

    it("ends an activity with its final state and when to dismiss it", async () => {
      const token = apnsToken()
      jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000)

      await configured().send({
        event: "end",
        app: "buyer",
        token,
        environment: "production",
        priority: 10,
        content: { factory: "BuyerOrderActivity", props: { outcome: "delivered" } },
        dismissAt: new Date(1_800_000_600_000),
      })

      expect(apns.sentTo(token)[0]!.aps).toEqual({
        timestamp: 1_800_000_000,
        event: "end",
        "dismissal-date": 1_800_000_600,
        "content-state": { name: "BuyerOrderActivity", props: '{"outcome":"delivered"}' },
      })
    })
  })

  describe("Apple's hosts", () => {
    it("sends each token to the host of its recorded environment, over one connection each", async () => {
      const sender = configured()
      const update = (token: string, environment: "sandbox" | "production") =>
        sender.send({ event: "update", app: "buyer", token, environment, priority: 5, content })
      const [sandbox, production] = [apnsToken(), apnsToken()]

      await update(sandbox, "sandbox")
      await update(production, "production")
      await update(sandbox, "sandbox")

      expect(apns.sentTo(sandbox).map((p) => p.environment)).toEqual(["sandbox", "sandbox"])
      expect(apns.sentTo(production).map((p) => p.environment)).toEqual(["production"])
      expect(apns.connections()).toBe(2)
    })

    it("reconnects after Apple closes the connection", async () => {
      const sender = configured()
      const update = (token: string) =>
        sender.send({ event: "update", app: "buyer", token, environment: "sandbox", priority: 5, content })
      await update(apnsToken())

      apns.dropConnections()
      await new Promise((resolve) => setTimeout(resolve, 50))

      await expect(update(apnsToken())).resolves.toEqual({ status: "sent" })
    })
  })

  describe("the signing token", () => {
    const MINUTE = 60 * 1000
    const start = 1_800_000_000_000
    const sendAt = async (sender: LiveActivityPushModuleService, at: number) => {
      jest.spyOn(Date, "now").mockReturnValue(at)
      const token = apnsToken()
      const result = await sender.send({ event: "update", app: "buyer", token, environment: "sandbox", priority: 5, content })
      expect(result).toEqual({ status: "sent" })
      return apns.sentTo(token)[0]!.authorization
    }

    it("is reused for 20 minutes, since Apple refuses tokens refreshed more often", async () => {
      const sender = configured()

      const first = await sendAt(sender, start)
      const later = await sendAt(sender, start + 20 * MINUTE)

      expect(later).toBe(first)
    })

    it("is refreshed before Apple's hour runs out, so pushes keep being accepted", async () => {
      const sender = configured()

      const first = await sendAt(sender, start)
      const nearTheHour = await sendAt(sender, start + 59 * MINUTE)
      const pastTheFirstHour = await sendAt(sender, start + 61 * MINUTE)

      expect(nearTheHour).not.toBe(first)
      expect(pastTheFirstHour).toBe(nearTheHour)
    })
  })

  describe("when Apple refuses", () => {
    const update = (sender: LiveActivityPushModuleService, token: string) =>
      sender.send({ event: "update", app: "buyer", token, environment: "sandbox", priority: 5, content })

    it("reports a token Apple says is gone (410), for the caller to forget", async () => {
      const token = apnsToken()
      apns.unregister(token)

      await expect(update(configured(), token)).resolves.toEqual({ status: "token_rejected", reason: "Unregistered" })
    })

    it("reports a token Apple calls bad (BadDeviceToken), for the caller to forget", async () => {
      const token = apnsToken()
      apns.rejectAsBad(token)

      await expect(update(configured(), token)).resolves.toEqual({ status: "token_rejected", reason: "BadDeviceToken" })
    })

    it("logs any other refusal and reports it as a failure, not a rejected token", async () => {
      const result = await configured().send({
        event: "update",
        app: "buyer",
        token: apnsToken(),
        environment: "sandbox",
        priority: 5,
        content: { factory: "BuyerOrderActivity", props: { padding: "x".repeat(5000) } },
      })

      expect(result).toEqual({ status: "failed", reason: "413 PayloadTooLarge" })
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("413 PayloadTooLarge"))
    })

    it("logs a provider token Apple won't accept, leaving the device's token alone", async () => {
      const other = fakeApns(27000 + (process.pid % 1000), 28000 + (process.pid % 1000))
      const sender = senderWith({ ...optionsFor(apns), key: other.env.APNS_KEY })

      const result = await update(sender, apnsToken())

      expect(result).toEqual({ status: "failed", reason: "403 InvalidProviderToken" })
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("InvalidProviderToken"))
    })
  })

  describe("when Apple can't be reached", () => {
    const update = (sender: LiveActivityPushModuleService) =>
      sender.send({ event: "update", app: "buyer", token: apnsToken(), environment: "sandbox", priority: 5, content })

    it("logs a failure and reports it, without throwing", async () => {
      const closedPort = 29000 + (process.pid % 1000)
      const sender = senderWith({ ...optionsFor(apns), sandboxUrl: `http://127.0.0.1:${closedPort}` })

      const result = await update(sender)

      expect(result).toMatchObject({ status: "failed" })
      expect(logger.warn).toHaveBeenCalled()
    })

    it("gives up on an answer that never comes", async () => {
      apns.hang()
      const sender = senderWith({ ...optionsFor(apns), timeoutMs: 50 })

      await expect(update(sender)).resolves.toEqual({ status: "failed", reason: "no answer after 50ms" })
    })
  })

  describe("when it isn't configured", () => {
    const update = (sender: LiveActivityPushModuleService) =>
      sender.send({ event: "update", app: "buyer", token: apnsToken(), environment: "sandbox", priority: 5, content })

    it("sends nothing and logs, with no key", async () => {
      const sender = senderWith({ ...optionsFor(apns), key: undefined })

      await expect(update(sender)).resolves.toEqual({ status: "not_configured" })

      expect(apns.pushes()).toEqual([])
      expect(apns.connections()).toBe(0)
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("not sent"))
    })

    it("sends nothing and logs, with no bundle id for that app", async () => {
      const sender = senderWith({ ...optionsFor(apns), bundleIds: { vendor: "com.example.oja.vendor" } })

      await expect(update(sender)).resolves.toEqual({ status: "not_configured" })

      expect(apns.pushes()).toEqual([])
    })

    it("reads the key from a file outside the repo", async () => {
      const dir = mkdtempSync(join(tmpdir(), "apns-key-"))
      const keyPath = join(dir, "AuthKey.p8")
      writeFileSync(keyPath, apns.env.APNS_KEY)

      const sender = senderWith({ ...optionsFor(apns), key: undefined, keyPath })

      await expect(update(sender)).resolves.toEqual({ status: "sent" })
      rmSync(dir, { recursive: true })
    })

    it("accepts a key whose line breaks came through the host's variables as \\n", async () => {
      const sender = senderWith({ ...optionsFor(apns), key: apns.env.APNS_KEY.replaceAll("\n", "\\n") })

      await expect(update(sender)).resolves.toEqual({ status: "sent" })
    })

    it("logs a key file it can't read, and sends nothing", async () => {
      const sender = senderWith({ ...optionsFor(apns), key: undefined, keyPath: "/nonexistent/AuthKey.p8" })

      await expect(update(sender)).resolves.toEqual({ status: "not_configured" })
      expect(logger.warn).toHaveBeenCalled()
      expect(apns.connections()).toBe(0)
    })

    it("reports a key it can't sign with as a failure, without throwing", async () => {
      const sender = senderWith({ ...optionsFor(apns), key: "not a key" })

      await expect(update(sender)).resolves.toMatchObject({ status: "failed" })
      expect(logger.warn).toHaveBeenCalled()
    })
  })
})
