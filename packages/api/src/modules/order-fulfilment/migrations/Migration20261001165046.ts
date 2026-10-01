import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261001165046 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_refund" drop constraint if exists "order_refund_refund_id_unique";`);
    this.addSql(`alter table if exists "order_fulfilment" drop constraint if exists "order_fulfilment_order_id_unique";`);
    this.addSql(`create table if not exists "order_fulfilment" ("id" text not null, "order_id" text not null, "state" text not null, "fulfilment" jsonb not null, "placed_at" timestamptz not null, "reject_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_fulfilment_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_fulfilment_order_id_unique" ON "order_fulfilment" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_deleted_at" ON "order_fulfilment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_state_placed_at" ON "order_fulfilment" ("state", "placed_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "order_refund" ("id" text not null, "order_id" text not null, "payment_id" text not null, "refund_id" text not null, "amount" numeric not null, "currency_code" text not null, "transaction_reference" text not null, "paystack_refund_id" text null, "status" text check ("status" in ('pending', 'processing', 'processed', 'failed', 'needs-attention')) not null default 'pending', "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "order_refund_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_order_refund_refund_id_unique" ON "order_refund" ("refund_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_refund_deleted_at" ON "order_refund" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_refund_order_id" ON "order_refund" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_refund_transaction_reference" ON "order_refund" ("transaction_reference") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_fulfilment" cascade;`);

    this.addSql(`drop table if exists "order_refund" cascade;`);
  }

}
