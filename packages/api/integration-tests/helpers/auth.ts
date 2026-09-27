import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

type Api = { post: (url: string, body?: unknown, config?: unknown) => Promise<{ data: any }> }

const ADMIN_PASSWORD = "supersecret"

/** Registers an operator (admin user) and returns request config for the Admin API. */
export async function adminHeaders(container: MedusaContainer, api: Api, email = "operator@oja.test") {
  const auth = container.resolve(Modules.AUTH)
  const users = container.resolve(Modules.USER)
  const [existing] = await users.listUsers({ email })
  const user = existing ?? (await users.createUsers({ email }))
  const { authIdentity, success } = await auth.register("emailpass", {
    body: { email, password: ADMIN_PASSWORD },
  } as any)
  if (success && authIdentity) {
    await auth.updateAuthIdentities({ id: authIdentity.id, app_metadata: { user_id: user.id } })
  }
  const { data } = await api.post("/auth/user/emailpass", { email, password: ADMIN_PASSWORD })
  return { headers: { authorization: `Bearer ${data.token}` } }
}

/** Logs a seller member in and scopes requests to their shop. */
export async function vendorHeaders(api: Api, email: string, password: string, sellerId: string) {
  const { data } = await api.post("/auth/member/emailpass", { email, password })
  return { headers: { authorization: `Bearer ${data.token}`, "x-seller-id": sellerId } }
}
