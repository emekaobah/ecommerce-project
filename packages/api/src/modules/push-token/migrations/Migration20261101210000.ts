import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101210000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "push_token" add column if not exists "platform" text check ("platform" in ('ios', 'android')) null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "push_token" drop column if exists "platform";`);
  }

}
