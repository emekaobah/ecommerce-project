import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261022091437 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "shop_pin" drop constraint if exists "shop_pin_seller_id_unique";`);
    this.addSql(`create table if not exists "shop_pin" ("id" text not null, "seller_id" text not null, "latitude" real not null, "longitude" real not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "shop_pin_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_shop_pin_seller_id_unique" ON "shop_pin" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_shop_pin_deleted_at" ON "shop_pin" ("deleted_at") WHERE deleted_at IS NULL;`);

    // Every shop pinned before this table existed. Mercur's seller module owns "seller_address",
    // which a new database may not have yet; it has no shops to copy then.
    this.addSql(`DO $$ BEGIN
      IF to_regclass('seller_address') IS NOT NULL THEN
        INSERT INTO "shop_pin" ("id", "seller_id", "latitude", "longitude")
        SELECT 'shpin_' || "seller_id", "seller_id", ("metadata"->>'latitude')::real, ("metadata"->>'longitude')::real
        FROM "seller_address"
        WHERE "deleted_at" IS NULL AND "seller_id" IS NOT NULL
          AND jsonb_typeof("metadata"->'latitude') = 'number' AND jsonb_typeof("metadata"->'longitude') = 'number'
        ON CONFLICT DO NOTHING;
      END IF;
    END $$;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "shop_pin" cascade;`);
  }

}
