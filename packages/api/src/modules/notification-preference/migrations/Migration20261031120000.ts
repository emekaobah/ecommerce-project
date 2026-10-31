import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261031120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "notification_preference" drop constraint if exists "notification_preference_customer_id_unique";`);
    this.addSql(`create table if not exists "notification_preference" ("id" text not null, "customer_id" text not null, "cart_reminder_push" boolean not null default true, "cart_reminder_email" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_preference_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_preference_customer_id_unique" ON "notification_preference" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_preference_deleted_at" ON "notification_preference" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "notification_preference" cascade;`);
  }

}
