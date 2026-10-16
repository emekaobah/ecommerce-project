import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261016232914 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_refund" add column if not exists "covers" text check ("covers" in ('items', 'delivery')) not null default 'items';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_refund" drop column if exists "covers";`);
  }

}
