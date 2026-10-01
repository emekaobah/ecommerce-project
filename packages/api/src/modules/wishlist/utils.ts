import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import customerWishlist from "../../links/customer-wishlist";

/** The customer's wishlist, or undefined before they first save something. */
export async function getWishlistFromCustomerId(
  container: Pick<MedusaContainer, "resolve">,
  customerId: string
): Promise<{ id: string } | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: customerWishlist.entryPoint,
    fields: ["wishlist_id"],
    filters: { customer_id: customerId },
  });
  const link = data[0] as { wishlist_id: string } | undefined;
  return link ? { id: link.wishlist_id } : undefined;
}
