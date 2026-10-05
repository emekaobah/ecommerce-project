import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261005130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "accept_reminded_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "accept_reminded_at";`);
  }

}
