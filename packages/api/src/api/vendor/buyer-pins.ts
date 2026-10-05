import { withoutBuyerPins } from "../../lib/buyer-pins"
import { viewResponses } from "./shop-share"

/** Every vendor response, without the pin of any buyer address in it (ADR 0002). */
export const hideBuyerPins = viewResponses((_req, body) => Promise.resolve(withoutBuyerPins(body)))
