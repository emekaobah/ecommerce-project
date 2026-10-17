import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261016232914 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_refund" add column if not exists "covers" text check ("covers" in ('items', 'delivery', 'all')) not null default 'items';`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_refund" drop column if exists "covers";`);
  }

}
