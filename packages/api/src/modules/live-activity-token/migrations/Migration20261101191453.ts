import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261101191453 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "live_activity_shop" drop constraint if exists "live_activity_shop_device_id_seller_id_unique";`);
    this.addSql(`create table if not exists "live_activity_shop" ("id" text not null, "device_id" text not null, "seller_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "live_activity_shop_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_shop_device_id" ON "live_activity_shop" ("device_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_shop_deleted_at" ON "live_activity_shop" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_live_activity_shop_device_id_seller_id_unique" ON "live_activity_shop" ("device_id", "seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_live_activity_shop_seller_id" ON "live_activity_shop" ("seller_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "live_activity_shop" add constraint "live_activity_shop_device_id_foreign" foreign key ("device_id") references "live_activity_device" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "live_activity_shop" cascade;`);
  }

}
