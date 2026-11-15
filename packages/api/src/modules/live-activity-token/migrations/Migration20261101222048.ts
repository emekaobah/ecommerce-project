import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101222048 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "buyer_live_update" drop constraint if exists "buyer_live_update_push_token_order_id_unique";`);
    this.addSql(`create table if not exists "buyer_live_update" ("id" text not null, "push_token" text not null, "customer_id" text not null, "order_id" text not null, "ended_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "buyer_live_update_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_live_update_deleted_at" ON "buyer_live_update" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_buyer_live_update_push_token_order_id_unique" ON "buyer_live_update" ("push_token", "order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_buyer_live_update_customer_id" ON "buyer_live_update" ("customer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "buyer_live_update" cascade;`);
  }

}
