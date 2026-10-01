import { defineLink } from "@medusajs/framework/utils";
import ProductModule from "@medusajs/medusa/product";

import WishlistModule from "../modules/wishlist";

// Products are always shown as one shop's offer (docs/design.md), so each saved
// product keeps the shop it was saved from.
export default defineLink(
  { linkable: WishlistModule.linkable.wishlist, isList: true },
  {
    linkable: ProductModule.linkable.product,
    deleteCascade: false,
    isList: true,
  },
  {
    database: {
      extraColumns: {
        seller_id: { type: "text" },
      },
    },
  }
);
