import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// A courier staff chose above the top-up cap, waiting for Oja's team to approve it (#19).
export class Migration20261018090000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "courier_approval" jsonb null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "courier_approval";`);
  }

}
