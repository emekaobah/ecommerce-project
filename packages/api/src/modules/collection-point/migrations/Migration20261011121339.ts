import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261011121339 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "collection_point" drop constraint if exists "collection_point_seller_id_unique";`);
    this.addSql(`create table if not exists "collection_point" ("id" text not null, "seller_id" text not null, "follows_pickup_address" boolean not null, "address" jsonb null, "instructions" text not null, "phone" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "collection_point_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_collection_point_seller_id_unique" ON "collection_point" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_collection_point_deleted_at" ON "collection_point" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "collection_point" cascade;`);
  }

}
