import type { Context } from "@medusajs/framework/types"
import { InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import PopularSearch from "./models/popular-search"
import SearchRecord from "./models/search-record"

class PopularSearchModuleService extends MedusaService({ SearchRecord, PopularSearch }) {
  /**
   * Replaces the region's popular searches with `terms`, most popular first, in one transaction,
   * so a buyer never sees half a list. Returns the terms it replaced, in order.
   */
  @InjectTransactionManager()
  async replacePopularSearches(
    regionId: string,
    terms: string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<string[]> {
    const previous = await this.listPopularSearches({ region_id: regionId }, { order: { rank: "ASC" } }, sharedContext)
    await this.deletePopularSearches({ region_id: regionId }, sharedContext)
    if (terms.length) {
      await this.createPopularSearches(
        terms.map((term, rank) => ({ region_id: regionId, term, rank })),
        sharedContext
      )
    }
    return previous.map((p) => p.term)
  }
}

export default PopularSearchModuleService
