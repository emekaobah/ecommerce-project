import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261010120000 extends Migration {

  override up(): void {
    this.addSql(`create table if not exists "shop_payout" ("id" text not null, "order_id" text not null, "seller_id" text not null, "payout_id" text null, "currency_code" text not null, "paid" numeric not null, "refunded" numeric not null, "delivery" numeric not null, "commission" numeric not null, "amount" numeric not null, "recovered" numeric not null, "transfer_reference" text not null, "raw_paid" jsonb not null, "raw_refunded" jsonb not null, "raw_delivery" jsonb not null, "raw_commission" jsonb not null, "raw_amount" jsonb not null, "raw_recovered" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_payout_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_payout_order_id_unique" ON "shop_payout" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_payout_payout_id_unique" ON "shop_payout" ("payout_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_payout_transfer_reference_unique" ON "shop_payout" ("transfer_reference") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_payout_deleted_at" ON "shop_payout" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_payout_seller_id" ON "shop_payout" ("seller_id") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "shop_payout" cascade;`);
  }

}
