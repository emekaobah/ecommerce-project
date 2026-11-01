import { createPublicKey, createVerify, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { createServer, type Http2Server, type Http2Session, type IncomingHttpHeaders } from "node:http2"

/** A Live Activity push as it reached Apple: the host it was sent to, its headers and payload. */
export type ApnsPush = {
  environment: "sandbox" | "production"
  token: string
  authorization?: string
  pushType?: string
  topic?: string
  priority?: string
  aps: Record<string, any>
}

/** A made-up APNs device token, as iOS hands the app. */
export const apnsToken = () => randomBytes(32).toString("hex")

/** Apple's limit on a Live Activity payload. */
const MAX_PAYLOAD_BYTES = 4096
const PROVIDER_TOKEN_LIFETIME_MS = 60 * 60 * 1000

/**
 * Stands in for Apple's push service, on one port per host: the backend's `APNS_SANDBOX_URL` and
 * `APNS_PRODUCTION_URL` point here. It speaks HTTP/2 like Apple (without TLS), checks each
 * provider token against its own key as Apple does, and records each push it accepts for tests
 * to inspect. `env` is the configuration a backend needs to send to it.
 */
export function fakeApns(sandboxPort: number, productionPort: number) {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  const keyId = randomUUID().slice(0, 10).toUpperCase()
  const teamId = randomUUID().slice(0, 10).toUpperCase()

  const pushes: ApnsPush[] = []
  /** Connections opened to either host, however many pushes each carried. */
  let connections = 0
  const unregistered = new Set<string>()
  const badTokens = new Set<string>()
  let unresponsive = false
  const sessions = new Set<Http2Session>()
  let servers: Http2Server[] = []

  /** Why Apple would refuse this provider token, if it would. */
  const refusedProviderToken = (authorization: string | undefined) => {
    const [header, claims, signature] = (authorization?.replace(/^bearer /, "") ?? "").split(".")
    if (!header || !claims || !signature) return "MissingProviderToken"
    const verified = createVerify("SHA256")
      .update(`${header}.${claims}`)
      .verify({ key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))
    const { alg, kid } = JSON.parse(Buffer.from(header, "base64url").toString())
    const { iss, iat } = JSON.parse(Buffer.from(claims, "base64url").toString())
    if (!verified || alg !== "ES256" || kid !== keyId || iss !== teamId) return "InvalidProviderToken"
    return Date.now() - iat * 1000 > PROVIDER_TOKEN_LIFETIME_MS ? "ExpiredProviderToken" : null
  }

  const answer = (headers: IncomingHttpHeaders, raw: string, environment: ApnsPush["environment"]) => {
    const refused = refusedProviderToken(headers.authorization)
    if (refused) return { status: 403, reason: refused }
    if (headers["apns-push-type"] !== "liveactivity") return { status: 400, reason: "InvalidPushType" }
    if (Buffer.byteLength(raw) > MAX_PAYLOAD_BYTES) return { status: 413, reason: "PayloadTooLarge" }
    const token = String(headers[":path"]).replace("/3/device/", "")
    if (badTokens.has(token)) return { status: 400, reason: "BadDeviceToken" }
    if (unregistered.has(token)) return { status: 410, reason: "Unregistered" }
    pushes.push({
      environment,
      token,
      authorization: headers.authorization,
      pushType: headers["apns-push-type"] as string,
      topic: headers["apns-topic"] as string,
      priority: headers["apns-priority"] as string,
      aps: JSON.parse(raw).aps,
    })
    return { status: 200 }
  }

  const listen = (port: number, environment: ApnsPush["environment"]) =>
    new Promise<void>((resolve) => {
      const server = createServer()
      server.on("session", (session) => {
        connections += 1
        sessions.add(session)
        session.on("close", () => sessions.delete(session))
      })
      server.on("stream", (stream, headers) => {
        stream.on("error", () => {})
        let raw = ""
        stream.on("data", (chunk) => (raw += chunk))
        stream.on("end", () => {
          if (unresponsive) return
          const { status, reason } = answer(headers, raw, environment)
          stream.respond({ ":status": status, "apns-id": randomUUID() })
          stream.end(reason ? JSON.stringify({ reason }) : undefined)
        })
      })
      servers.push(server)
      server.listen(port, "127.0.0.1", resolve)
    })

  return {
    env: {
      APNS_KEY: privateKey,
      APNS_KEY_ID: keyId,
      APNS_TEAM_ID: teamId,
      APNS_SANDBOX_URL: `http://127.0.0.1:${sandboxPort}`,
      APNS_PRODUCTION_URL: `http://127.0.0.1:${productionPort}`,
      APNS_BUYER_BUNDLE_ID: "com.example.oja.buyer",
      APNS_VENDOR_BUNDLE_ID: "com.example.oja.vendor",
    },
    start: async () => {
      await Promise.all([listen(sandboxPort, "sandbox"), listen(productionPort, "production")])
    },
    stop: async () => {
      for (const session of sessions) session.destroy()
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
      servers = []
    },
    /** Every accepted push to this token, oldest first. */
    sentTo: (token: string) => pushes.filter((p) => p.token === token),
    /** Every accepted push, oldest first. */
    pushes: () => [...pushes],
    /** How many connections have been opened to Apple so far. */
    connections: () => connections,
    /** Apple answers 410 Unregistered for this token: the activity or app is gone. */
    unregister: (token: string) => {
      unregistered.add(token)
    },
    /** Apple answers 400 BadDeviceToken for this token. */
    rejectAsBad: (token: string) => {
      badTokens.add(token)
    },
    /** Apple stops answering, but keeps the connection open. */
    hang: () => {
      unresponsive = true
    },
    /** Apple closes every open connection, as it does to idle ones. */
    dropConnections: () => {
      for (const session of sessions) session.destroy()
    },
    reset: () => {
      pushes.length = 0
      connections = 0
      unregistered.clear()
      badTokens.clear()
      unresponsive = false
    },
  }
}
