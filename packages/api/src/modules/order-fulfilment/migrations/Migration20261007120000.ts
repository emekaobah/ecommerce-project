import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261007120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "shipment" jsonb null, add column if not exists "shipment_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_shipment_id" ON "order_fulfilment" ("shipment_id") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop index if exists "IDX_order_fulfilment_shipment_id";`);
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "shipment", drop column if exists "shipment_id";`);
  }

}
