import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_refund" drop constraint if exists "order_refund_covers_check";`);
    this.addSql(`alter table if exists "order_refund" add constraint "order_refund_covers_check" check ("covers" in ('items', 'delivery', 'all'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "order_refund" drop constraint if exists "order_refund_covers_check";`);
    this.addSql(`alter table if exists "order_refund" add constraint "order_refund_covers_check" check ("covers" in ('items', 'delivery'));`);
  }

}
