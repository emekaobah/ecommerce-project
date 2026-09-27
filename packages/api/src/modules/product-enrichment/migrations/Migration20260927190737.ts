import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260927190737 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_enrichment" drop constraint if exists "product_enrichment_product_id_unique";`);
    this.addSql(`create table if not exists "product_enrichment" ("id" text not null, "product_id" text not null, "status" text check ("status" in ('queued', 'done', 'failed')) not null default 'queued', "submitter" text check ("submitter" in ('operator', 'vendor')) not null, "outcome" text check ("outcome" in ('published', 'needs_review', 'incomplete')) null, "fields" jsonb not null default '{}', "images" jsonb not null default '{"items":[]}', "attribution" jsonb not null default '{"items":[]}', "reasons" jsonb not null default '{"items":[]}', "errors" jsonb not null default '{"items":[]}', "enriched_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_enrichment_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_enrichment_product_id_unique" ON "product_enrichment" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_enrichment_deleted_at" ON "product_enrichment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_enrichment_outcome" ON "product_enrichment" ("outcome") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_enrichment_status" ON "product_enrichment" ("status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_enrichment" cascade;`);
  }

}
