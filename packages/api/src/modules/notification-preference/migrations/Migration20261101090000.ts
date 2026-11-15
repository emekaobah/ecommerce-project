import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "notification_preference" add column if not exists "orders_on_lock_screen" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "notification_preference" drop column if exists "orders_on_lock_screen";`);
  }

}
