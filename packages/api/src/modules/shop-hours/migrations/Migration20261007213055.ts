import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261007213055 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "shop_weekly_hours" drop constraint if exists "shop_weekly_hours_seller_id_unique";`);
    this.addSql(`create table if not exists "shop_hours_exception" ("id" text not null, "seller_id" text not null, "starts_on" text not null, "ends_on" text not null, "closed" boolean not null, "periods" jsonb not null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_hours_exception_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_hours_exception_deleted_at" ON "shop_hours_exception" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_hours_exception_seller_id_ends_on" ON "shop_hours_exception" ("seller_id", "ends_on") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "shop_pause" ("id" text not null, "seller_id" text not null, "starts_at" timestamptz not null, "ends_at" timestamptz null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_pause_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_pause_deleted_at" ON "shop_pause" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_pause_seller_id_ends_at" ON "shop_pause" ("seller_id", "ends_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "shop_weekly_hours" ("id" text not null, "seller_id" text not null, "weekly" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_weekly_hours_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_weekly_hours_seller_id_unique" ON "shop_weekly_hours" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_weekly_hours_deleted_at" ON "shop_weekly_hours" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shop_hours_exception" cascade;`);

    this.addSql(`drop table if exists "shop_pause" cascade;`);

    this.addSql(`drop table if exists "shop_weekly_hours" cascade;`);
  }

}
