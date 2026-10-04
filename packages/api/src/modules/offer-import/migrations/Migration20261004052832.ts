import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261004052832 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "offer_import_mapping" drop constraint if exists "offer_import_mapping_seller_id_unique";`);
    this.addSql(`alter table if exists "offer_cost" drop constraint if exists "offer_cost_offer_id_unique";`);
    this.addSql(`create table if not exists "offer_cost" ("id" text not null, "offer_id" text not null, "seller_id" text not null, "amount" numeric not null, "currency_code" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "offer_cost_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_offer_cost_offer_id_unique" ON "offer_cost" ("offer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_offer_cost_deleted_at" ON "offer_cost" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_offer_cost_seller_id" ON "offer_cost" ("seller_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "offer_import_mapping" ("id" text not null, "seller_id" text not null, "mapping" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "offer_import_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_offer_import_mapping_seller_id_unique" ON "offer_import_mapping" ("seller_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_offer_import_mapping_deleted_at" ON "offer_import_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "offer_cost" cascade;`);

    this.addSql(`drop table if exists "offer_import_mapping" cascade;`);
  }

}
