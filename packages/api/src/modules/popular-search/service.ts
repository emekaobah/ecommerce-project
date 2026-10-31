import type { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"
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

  /**
   * Deletes the searches recorded before `before`, for good, in one statement that loads none of
   * them, so a backlog is never read into memory. Returns how many it deleted.
   */
  @InjectTransactionManager()
  async forgetSearchRecords(before: Date, @MedusaContext() sharedContext: Context = {}): Promise<number> {
    const manager = sharedContext.transactionManager as SqlEntityManager
    const { affectedRows } = await manager.execute<{ affectedRows: number }>("DELETE FROM search_record WHERE searched_at < ?", [before], "run")
    return affectedRows
  }
}

export default PopularSearchModuleService
