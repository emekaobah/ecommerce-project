import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101221203 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" add column if not exists "end_content" jsonb null, add column if not exists "end_dismiss_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" drop column if exists "end_content", drop column if exists "end_dismiss_at";`);
  }

}
