import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MemberInviteWorkflowEvents } from "@mercurjs/core/workflows"

type InviteCreated = { id: string; token: string }

// Mercur creates staff invites (owner → Settings → Users in the vendor panel)
// and emits an event, but sends nothing: this emails the invitee the vendor
// panel's accept link. Emails go out on the "email" channel, whose provider is
// configured in medusa-config.
export default async function memberInviteEmailHandler({
  event,
  container,
}: SubscriberArgs<InviteCreated | InviteCreated[]>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const vendorUrl = process.env.MERCUR_VENDOR_URL

  for (const { id, token } of Array.isArray(event.data) ? event.data : [event.data]) {
    const { data: [invite] } = await query.graph({
      entity: "member_invite",
      fields: ["email", "role_id", "seller_id"],
      filters: { id },
    })
    if (!invite) continue
    const [{ data: [seller] }, { data: [role] }] = await Promise.all([
      query.graph({ entity: "seller", fields: ["name"], filters: { id: invite.seller_id } }),
      query.graph({ entity: "rbac_role", fields: ["name"], filters: { id: invite.role_id } }),
    ])

    const inviteUrl = `${vendorUrl}/invite?token=${encodeURIComponent(token)}`
    const sellerName = seller?.name ?? "a shop"
    const roleName = role?.name ?? invite.role_id
    await container.resolve(Modules.NOTIFICATION).createNotifications({
      to: invite.email,
      channel: "email",
      template: "member-invite",
      data: { invite_url: inviteUrl, seller_name: sellerName, role: roleName },
      content: {
        subject: `You've been invited to join ${sellerName}`,
        html: `<p>You've been invited to join <strong>${escapeHtml(sellerName)}</strong> as ${escapeHtml(
          roleName
        )}.</p><p><a href="${escapeHtml(inviteUrl)}">Accept the invite</a></p>`,
      },
    })
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export const config: SubscriberConfig = {
  event: MemberInviteWorkflowEvents.CREATED,
  context: { subscriberId: "member-invite-email" },
}
