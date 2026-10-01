import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk";

import {
  CreateWishlistDTO,
  WISHLIST_MODULE,
  WishlistModuleService,
} from "../../../modules/wishlist";
import { getWishlistFromCustomerId } from "../../../modules/wishlist/utils";
import wishlistProduct from "../../../links/wishlist-product";
import { Link } from "@medusajs/framework/modules-sdk";

const productLink = (wishlistId: string, productId: string) => ({
  [WISHLIST_MODULE]: { wishlist_id: wishlistId },
  [Modules.PRODUCT]: { product_id: productId },
});

type Compensation = { wishlistId: string; productId: string; previousSellerId: string | null };

/** Saves the product from the shop, replacing the shop it was saved from before, if any. */
export const createWishlistEntryStep = createStep(
  "create-wishlist",
  async (input: CreateWishlistDTO, { container }) => {
    const service = container.resolve<WishlistModuleService>(WISHLIST_MODULE);
    const link = container.resolve<Link>(ContainerRegistrationKeys.LINK);
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    let wishlist = await getWishlistFromCustomerId(container, input.customer_id);
    if (!wishlist) {
      wishlist = await service.createWishlists({ reference: input.reference });
      await link.create([
        {
          [Modules.CUSTOMER]: { customer_id: input.customer_id },
          [WISHLIST_MODULE]: { wishlist_id: wishlist.id },
        },
      ]);
    }

    const { data } = await query.graph({
      entity: wishlistProduct.entryPoint,
      fields: ["seller_id"],
      filters: { wishlist_id: wishlist.id, product_id: input.reference_id },
    });
    const previousSellerId = (data[0] as { seller_id: string } | undefined)?.seller_id ?? null;
    // Saving it again replaces the shop it was saved from.
    await link.create([{ ...productLink(wishlist.id, input.reference_id), data: { seller_id: input.seller_id } }]);

    return new StepResponse<{ id: string }, Compensation>(wishlist, {
      wishlistId: wishlist.id,
      productId: input.reference_id,
      previousSellerId,
    });
  },
  async (compensation, { container }) => {
    if (!compensation) return;
    const { wishlistId, productId, previousSellerId } = compensation;
    const link = container.resolve<Link>(ContainerRegistrationKeys.LINK);
    if (previousSellerId) {
      await link.create([{ ...productLink(wishlistId, productId), data: { seller_id: previousSellerId } }]);
    } else {
      await link.dismiss([productLink(wishlistId, productId)]);
    }
  }
);
