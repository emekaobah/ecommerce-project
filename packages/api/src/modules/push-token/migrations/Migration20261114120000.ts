import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261114120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "push_token" add column if not exists "session" text null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "push_token" drop column if exists "session";`);
  }

}
