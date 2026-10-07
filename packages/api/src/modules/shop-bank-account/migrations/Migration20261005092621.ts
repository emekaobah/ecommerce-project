import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261005092621 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "shop_bank_account" drop constraint if exists "shop_bank_account_seller_id_unique";`);
    this.addSql(`create table if not exists "shop_bank_account" ("id" text not null, "seller_id" text not null, "currency_code" text not null, "bank_code" text not null, "bank_name" text not null, "account_number" text not null, "account_name" text not null, "recipient_code" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_bank_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_bank_account_seller_id_unique" ON "shop_bank_account" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_bank_account_deleted_at" ON "shop_bank_account" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "shop_bank_account" cascade;`);
  }

}
