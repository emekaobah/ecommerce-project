import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017125000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_refund" add column if not exists "failure_reason" text null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_refund" drop column if exists "failure_reason";`);
  }

}
