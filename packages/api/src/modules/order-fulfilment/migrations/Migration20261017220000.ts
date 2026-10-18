import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// The last reminder the buyer of a pickup order still to collect had (#33).
export class Migration20261017220000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "hold_reminded" text check ("hold_reminded" in ('half_way', 'last_day')) null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "hold_reminded";`);
  }

}
