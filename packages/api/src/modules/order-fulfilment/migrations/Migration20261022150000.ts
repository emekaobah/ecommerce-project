import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// Whether each order is in progress or past for its buyer (#59), and the buyer's orders indexed
// by it. Rows start in progress; the `backfill-order-fulfilments` migration script, which runs
// after this, works out each existing row's phase from its state and refunds.
export class Migration20261022150000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "phase" text check ("phase" in ('in_progress', 'past')) not null default 'in_progress';`);
    this.addSql(`alter table if exists "order_fulfilment" alter column "phase" drop default;`);
    this.addSql(`drop index if exists "IDX_order_fulfilment_customer_id_placed_at";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_customer_id_phase_placed_at" ON "order_fulfilment" ("customer_id", "phase", "placed_at") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop index if exists "IDX_order_fulfilment_customer_id_phase_placed_at";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_order_fulfilment_customer_id_placed_at" ON "order_fulfilment" ("customer_id", "placed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "phase";`);
  }

}
