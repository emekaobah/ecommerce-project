import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Whose order each fulfilment row is (#58): its buyer, shop and checkout, indexed. The columns are
// filled, and orders without a row given one, by the `backfill-order-fulfilments` migration
// script, which runs once the links it reads them from are synced.
export class Migration20261022120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "customer_id" text null, add column if not exists "seller_id" text null, add column if not exists "order_group_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_customer_id_placed_at" ON "order_fulfilment" ("customer_id", "placed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_seller_id_state" ON "order_fulfilment" ("seller_id", "state") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_order_group_id" ON "order_fulfilment" ("order_group_id") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop index if exists "IDX_order_fulfilment_customer_id_placed_at";`);
    this.addSql(`drop index if exists "IDX_order_fulfilment_seller_id_state";`);
    this.addSql(`drop index if exists "IDX_order_fulfilment_order_group_id";`);
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "customer_id", drop column if exists "seller_id", drop column if exists "order_group_id";`);
  }

}
