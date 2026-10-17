import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017130000 extends Migration {

  override up(): void {
    this.addSql(`create table if not exists "refund_settlement" ("id" text not null, "order_id" text not null, "amount" numeric not null, "currency_code" text not null, "method" text check ("method" in ('bank_transfer', 'other')) not null, "note" text not null, "settled_by" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "refund_settlement_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refund_settlement_order_id" ON "refund_settlement" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_refund_settlement_deleted_at" ON "refund_settlement" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "refund_settlement" cascade;`);
  }

}
