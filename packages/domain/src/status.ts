/**
 * What a status chip shows (#76): a label, a tone and a symbol, so status never relies on colour
 * alone. The tones are the catalogue's chip pairs; ember (`attention`) is kept for what waits on
 * the buyer and a new order's last two hours to accept, and nothing else.
 */
export type StatusTone =
  /** Closed, sold out, rejected, cancelled: finished or unavailable. */
  | "neutral"
  /** Moving along: being prepared, packed, on its way. */
  | "info"
  /** Open, done: delivered, collected, refunded, published. */
  | "success"
  /** Waiting on someone other than the buyer: the shop, moderation, a refund retry. */
  | "new"
  /** Waiting on the buyer, or a new order in its last two hours to accept. */
  | "attention"
  /** An error. */
  | "danger"

/** The catalogue's drawn icon names a chip uses; `@oja/ui`'s Icon draws each. */
export type StatusSymbol = "clock" | "box" | "truck" | "store" | "check" | "info" | "x"

export type StatusChipView = { label: string; tone: StatusTone; icon: StatusSymbol }

/** A chip, and a line to say more under it. */
export type StatusView = StatusChipView & { note: string | null }
