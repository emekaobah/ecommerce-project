import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101193852 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" add column if not exists "sent_content" jsonb null, add column if not exists "sent_at" timestamptz null;`);

    this.addSql(`alter table if exists "live_activity_shop" add column if not exists "closed_seen_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" drop column if exists "sent_content", drop column if exists "sent_at";`);

    this.addSql(`alter table if exists "live_activity_shop" drop column if exists "closed_seen_at";`);
  }

}
