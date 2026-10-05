import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261005092250 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "perishable_product" drop constraint if exists "perishable_product_product_id_unique";`);
    this.addSql(`alter table if exists "perishable_category" drop constraint if exists "perishable_category_category_id_unique";`);
    this.addSql(`create table if not exists "perishable_category" ("id" text not null, "category_id" text not null, "perishable" boolean not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "perishable_category_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_perishable_category_category_id_unique" ON "perishable_category" ("category_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_perishable_category_deleted_at" ON "perishable_category" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "perishable_product" ("id" text not null, "product_id" text not null, "perishable" boolean not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "perishable_product_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_perishable_product_product_id_unique" ON "perishable_product" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_perishable_product_deleted_at" ON "perishable_product" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "perishable_category" cascade;`);

    this.addSql(`drop table if exists "perishable_product" cascade;`);
  }

}
