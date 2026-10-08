import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261007120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "unavailable" jsonb null, add column if not exists "removed" jsonb null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "unavailable", drop column if exists "removed";`);
  }

}
