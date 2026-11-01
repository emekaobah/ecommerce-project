import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101183756 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" drop constraint if exists "live_activity_token_unique";`);
    this.addSql(`alter table if exists "live_activity" drop constraint if exists "live_activity_apple_id_unique";`);
    this.addSql(`alter table if exists "live_activity" drop constraint if exists "live_activity_device_id_kind_subject_id_unique";`);
    this.addSql(`alter table if exists "live_activity_device" drop constraint if exists "live_activity_device_push_token_unique";`);
    this.addSql(`alter table if exists "live_activity_device" drop constraint if exists "live_activity_device_push_to_start_token_unique";`);
    this.addSql(`alter table if exists "live_activity_device" drop constraint if exists "live_activity_device_key_hash_unique";`);
    this.addSql(`create table if not exists "live_activity_device" ("id" text not null, "app" text check ("app" in ('buyer', 'vendor')) not null, "actor_type" text check ("actor_type" in ('customer', 'member')) not null, "actor_id" text not null, "key_hash" text not null, "push_token" text null, "push_to_start_token" text null, "environment" text check ("environment" in ('sandbox', 'production')) not null, "update_token_reported_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "live_activity_device_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_device_key_hash_unique" ON "live_activity_device" ("key_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_device_deleted_at" ON "live_activity_device" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_device_actor_type_actor_id" ON "live_activity_device" ("actor_type", "actor_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_device_push_to_start_token_unique" ON "live_activity_device" ("push_to_start_token") WHERE push_to_start_token IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_device_push_token_unique" ON "live_activity_device" ("push_token") WHERE push_token IS NOT NULL AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "live_activity" ("id" text not null, "device_id" text not null, "kind" text check ("kind" in ('buyer_shop_order', 'vendor_shop')) not null, "subject_id" text null, "apple_id" text null, "token" text null, "environment" text check ("environment" in ('sandbox', 'production')) not null, "started_at" timestamptz not null, "ended_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "live_activity_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_device_id" ON "live_activity" ("device_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_deleted_at" ON "live_activity" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_device_id_kind_subject_id_unique" ON "live_activity" ("device_id", "kind", "subject_id") WHERE ended_at IS NULL AND subject_id IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_apple_id_unique" ON "live_activity" ("apple_id") WHERE apple_id IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_token_unique" ON "live_activity" ("token") WHERE token IS NOT NULL AND deleted_at IS NULL;`);

    this.addSql(`alter table if exists "live_activity" add constraint "live_activity_device_id_foreign" foreign key ("device_id") references "live_activity_device" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "live_activity" drop constraint if exists "live_activity_device_id_foreign";`);

    this.addSql(`drop table if exists "live_activity_device" cascade;`);

    this.addSql(`drop table if exists "live_activity" cascade;`);
  }

}
