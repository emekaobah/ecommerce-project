import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"
import { connect, constants, type ClientHttp2Session } from "node:http2"

export type ApnsEnvironment = "sandbox" | "production"
export type LiveActivityApp = "buyer" | "vendor"

type Alert = { title: string; body: string; sound?: string }

type Target = {
  app: LiveActivityApp
  /** A push-to-start token for a start; the activity's own update token otherwise. */
  token: string
  /** The push environment recorded with the token. */
  environment: ApnsEnvironment
  /** Apple's hourly budget counts 10s: use it only for starts, ends and alerting updates. */
  priority: 5 | 10
  /** What the widget shows: the factory its layout is registered under, and that layout's props. */
  content: { factory: string; props: Record<string, unknown> }
}

export type LiveActivityPush = Target &
  (
    | { event: "start"; alert: Alert }
    | { event: "update"; alert?: Alert }
    /** `content` stays on the Lock Screen until `dismissAt`, so send the real final state. */
    | { event: "end"; dismissAt: Date; alert?: Alert }
  )

/**
 * `sent` means Apple accepted the push, not that the phone showed it (#140). On `token_rejected`
 * the caller forgets the token. `failed` and `not_configured` are already logged, and the token
 * is still good.
 */
export type LiveActivityPushResult =
  | { status: "sent" }
  | { status: "token_rejected"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "not_configured" }

export type LiveActivityPushOptions = {
  keyId?: string
  teamId?: string
  /** The .p8 key's contents, for hosts without a file to point at. */
  key?: string
  /** Where the .p8 key is, when `key` isn't set. */
  keyPath?: string
  bundleIds?: Partial<Record<LiveActivityApp, string>>
  sandboxUrl?: string
  productionUrl?: string
  timeoutMs?: number
}

type Logger = { info: (message: string) => void; warn: (message: string) => void }

const SANDBOX_URL = "https://api.sandbox.push.apple.com"
const PRODUCTION_URL = "https://api.push.apple.com"
/** Apple refuses a signing token older than an hour, and throttles ones refreshed within 20 minutes. */
const SIGNING_TOKEN_LIFETIME_MS = 50 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 10 * 1000
const GONE = 410
const BAD_DEVICE_TOKEN = "BadDeviceToken"

/**
 * Sends Live Activity pushes straight to Apple (ADR 0017): `send` is the whole interface. It
 * never throws, so one device's failure can't stop the next device's push.
 */
export default class LiveActivityPushModuleService {
  private readonly logger: Logger
  private readonly options: LiveActivityPushOptions
  private readonly key?: string
  private readonly sessions = new Map<string, ClientHttp2Session>()
  private signingToken?: { value: string; signedAt: number }

  constructor({ logger }: { logger: Logger }, options: LiveActivityPushOptions = {}) {
    this.logger = logger
    this.options = options
    this.key = this.loadKey()
  }

  async send(push: LiveActivityPush): Promise<LiveActivityPushResult> {
    const bundleId = this.options.bundleIds?.[push.app]
    if (!this.key || !this.options.keyId || !this.options.teamId || !bundleId) {
      this.logger.info(`Live Activity ${push.event} not sent: Apple's push key or the ${push.app} app's bundle id isn't configured`)
      return { status: "not_configured" }
    }
    try {
      const { status, reason } = await this.post(push, bundleId)
      if (status === 200) return { status: "sent" }
      if (status === GONE || reason === BAD_DEVICE_TOKEN) return { status: "token_rejected", reason: reason ?? String(status) }
      return this.failed(push, `${status} ${reason ?? ""}`.trim())
    } catch (error) {
      return this.failed(push, error instanceof Error ? error.message : String(error))
    }
  }

  /** Closes the connections to Apple. A later `send` opens them again. */
  close() {
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
  }

  private failed(push: LiveActivityPush, reason: string): LiveActivityPushResult {
    // Only the start of the token: enough to tell devices apart in the logs.
    this.logger.warn(`Live Activity ${push.event} to ${push.token.slice(0, 8)}… failed: ${reason}`)
    return { status: "failed", reason }
  }

  private loadKey() {
    const { key, keyPath } = this.options
    // Hosts' variables often carry a PEM's line breaks as a literal \n.
    if (key) return key.replaceAll("\\n", "\n")
    if (!keyPath) return undefined
    try {
      return readFileSync(keyPath, "utf8")
    } catch (error) {
      this.logger.warn(`Can't read Apple's push key: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  private post(push: LiveActivityPush, bundleId: string) {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise<{ status?: number; reason?: string }>((resolve, reject) => {
      const req = this.session(push.environment).request({
        ":method": "POST",
        ":path": `/3/device/${push.token}`,
        authorization: `bearer ${this.currentSigningToken()}`,
        "apns-push-type": "liveactivity",
        "apns-topic": `${bundleId}.push-type.liveactivity`,
        "apns-priority": String(push.priority),
      })
      let status: number | undefined
      let body = ""
      req.setEncoding("utf8")
      req.on("response", (headers) => {
        status = headers[":status"]
      })
      req.on("data", (chunk) => (body += chunk))
      req.on("error", reject)
      req.setTimeout(timeoutMs, () => {
        reject(new Error(`no answer after ${timeoutMs}ms`))
        req.close(constants.NGHTTP2_CANCEL)
      })
      req.on("close", () => {
        if (status === undefined) reject(new Error("the connection closed before Apple answered"))
        else resolve({ status, reason: reasonIn(body) })
      })
      req.end(JSON.stringify({ aps: apsFor(push) }))
    })
  }

  /** The open connection to that environment's host. Apple asks senders to keep one open and reuse it. */
  private session(environment: ApnsEnvironment) {
    const url =
      environment === "sandbox"
        ? (this.options.sandboxUrl ?? SANDBOX_URL)
        : (this.options.productionUrl ?? PRODUCTION_URL)
    const open = this.sessions.get(url)
    if (open && !open.closed && !open.destroyed) return open

    const session = connect(url)
    const forget = () => {
      if (this.sessions.get(url) === session) this.sessions.delete(url)
    }
    // A push in flight hears of this through its own stream; this only stops the connection being reused.
    session.on("error", forget)
    session.on("goaway", forget)
    session.on("close", forget)
    // An idle connection shouldn't keep the process alive.
    session.unref()
    this.sessions.set(url, session)
    return session
  }

  private currentSigningToken() {
    const now = Date.now()
    if (this.signingToken && now - this.signingToken.signedAt < SIGNING_TOKEN_LIFETIME_MS) return this.signingToken.value
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const claims = { iss: this.options.teamId, iat: Math.floor(now / 1000) }
    const input = `${encode({ alg: "ES256", kid: this.options.keyId })}.${encode(claims)}`
    const signature = createSign("SHA256").update(input).sign({ key: this.key!, dsaEncoding: "ieee-p1363" })
    this.signingToken = { value: `${input}.${signature.toString("base64url")}`, signedAt: now }
    return this.signingToken.value
  }
}

function apsFor(push: LiveActivityPush) {
  return {
    timestamp: Math.floor(Date.now() / 1000),
    event: push.event,
    // The widget library's envelope. Apple accepts anything else, but the activity won't update.
    "content-state": { name: push.content.factory, props: JSON.stringify(push.content.props) },
    ...(push.alert && { alert: push.alert }),
    ...(push.event === "start" && {
      "attributes-type": "LiveActivityAttributes",
      attributes: {},
      // Asks iOS for the started activity's own update token.
      "input-push-token": 1,
    }),
    ...(push.event === "end" && { "dismissal-date": Math.floor(push.dismissAt.getTime() / 1000) }),
  }
}

function reasonIn(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { reason?: string }).reason
  } catch {
    return undefined
  }
}
