import { generateKeyPairSync, randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"

/**
 * Stands in for a Clerk instance: an RS256 key pair whose public half the backend
 * trusts as `CLERK_JWT_KEY`, and session tokens shaped like Clerk's (v2 claims).
 */
export function fakeClerk() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwtKey = publicKey.export({ type: "spki", format: "pem" }).toString()
  const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey

  type Claims = { sub?: string; email?: string; first_name?: string; last_name?: string; sts?: string }
  type Options = { expiresInSeconds?: number; signedBy?: "clerk" | "stranger" }

  const sessionToken = (claims: Claims = {}, { expiresInSeconds = 60, signedBy = "clerk" }: Options = {}) => {
    const now = Math.floor(Date.now() / 1000)
    return jwt.sign(
      {
        sub: `user_${randomUUID()}`,
        sid: `sess_${randomUUID()}`,
        iss: "https://oja-test.clerk.accounts.dev",
        v: 2,
        iat: now - 5,
        nbf: now - 5,
        exp: now + expiresInSeconds,
        ...claims,
      },
      signedBy === "clerk" ? privateKey : stranger,
      { algorithm: "RS256", keyid: "ins_test" }
    )
  }

  return { jwtKey, sessionToken }
}
