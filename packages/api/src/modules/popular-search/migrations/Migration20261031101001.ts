import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261031101001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "popular_search" ("id" text not null, "region_id" text not null, "term" text not null, "rank" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "popular_search_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_popular_search_deleted_at" ON "popular_search" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_popular_search_region_id" ON "popular_search" ("region_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "search_record" ("id" text not null, "term" text not null, "region_id" text not null, "phone_id" text not null, "searched_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "search_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_record_deleted_at" ON "search_record" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_record_region_id_searched_at" ON "search_record" ("region_id", "searched_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_record_searched_at" ON "search_record" ("searched_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "popular_search" cascade;`);

    this.addSql(`drop table if exists "search_record" cascade;`);
  }

}
