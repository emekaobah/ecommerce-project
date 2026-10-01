export type CreateWishlistDTO = {
  reference: "product";
  reference_id: string;
  /** The shop the buyer saved it from: the wishlist shows and moves that shop's offer. */
  seller_id: string;
  customer_id: string;
};

export type DeleteWishlistDTO = {
  id: string;
  reference_id: string;
};
