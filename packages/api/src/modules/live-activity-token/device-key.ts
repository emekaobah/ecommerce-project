import { createHash } from "node:crypto"

/** What's stored of a phone's key (ADR 0018): the SHA-256, so the table can't be used to report tokens. */
export const hashDeviceKey = (key: string) => createHash("sha256").update(key).digest("hex")
