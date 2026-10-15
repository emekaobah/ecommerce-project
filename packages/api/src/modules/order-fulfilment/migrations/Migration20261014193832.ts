import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261014193832 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "discount_funding" drop constraint if exists "discount_funding_order_id_promotion_id_unique";`);
    this.addSql(`create table if not exists "discount_funding" ("id" text not null, "order_id" text not null, "promotion_id" text not null, "code" text null, "oja_share" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discount_funding_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discount_funding_deleted_at" ON "discount_funding" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discount_funding_order_id_promotion_id_unique" ON "discount_funding" ("order_id", "promotion_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "shop_payout" add column if not exists "oja_discount" numeric not null default 0, add column if not exists "raw_oja_discount" jsonb not null default '{"value":"0","precision":20}';`);
  }

  override down(): void {
    this.addSql(`drop table if exists "discount_funding" cascade;`);

    this.addSql(`alter table if exists "shop_payout" drop column if exists "oja_discount", drop column if exists "raw_oja_discount";`);
  }

}
