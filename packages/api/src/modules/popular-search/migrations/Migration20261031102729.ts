import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261031102729 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "popular_search" drop constraint if exists "popular_search_region_id_rank_unique";`);
    this.addSql(`drop index if exists "IDX_popular_search_region_id";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_popular_search_region_id_rank_unique" ON "popular_search" ("region_id", "rank") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_search_record_region_id_searched_at";`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_popular_search_region_id_rank_unique";`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_popular_search_region_id" ON "popular_search" ("region_id") WHERE deleted_at IS NULL;`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_record_region_id_searched_at" ON "search_record" ("region_id", "searched_at") WHERE deleted_at IS NULL;`);
  }

}
