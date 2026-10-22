import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// The order lines a refund is for (#61). Refunds made before keep none: there is no backfill.
export class Migration20261022161100 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_refund" add column if not exists "lines" jsonb null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_refund" drop column if exists "lines";`);
  }

}
