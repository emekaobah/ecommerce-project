/** The filter for a shop's pause in force at an instant: started, and not ended. */
export const pauseInForce = (sellerId: string, at: Date) => ({
  seller_id: sellerId,
  starts_at: { $lte: at },
  $or: [{ ends_at: null }, { ends_at: { $gt: at } }],
})
