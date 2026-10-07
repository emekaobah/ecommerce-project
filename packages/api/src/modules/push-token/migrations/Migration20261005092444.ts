import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261005092444 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "push_token" drop constraint if exists "push_token_token_unique";`);
    this.addSql(`create table if not exists "push_token" ("id" text not null, "token" text not null, "actor_type" text check ("actor_type" in ('customer', 'member')) not null, "actor_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "push_token_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_push_token_token_unique" ON "push_token" ("token") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_token_deleted_at" ON "push_token" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_token_actor_type_actor_id" ON "push_token" ("actor_type", "actor_id") WHERE deleted_at IS NULL;`);
  }

  override down(): void {
    this.addSql(`drop table if exists "push_token" cascade;`);
  }

}
