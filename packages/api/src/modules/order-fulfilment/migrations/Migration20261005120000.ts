import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261005120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "picks" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "picks";`);
  }

}
