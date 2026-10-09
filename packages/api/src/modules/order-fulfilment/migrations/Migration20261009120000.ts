import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009120000 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "reached" jsonb null, add column if not exists "payout_eligible_at" timestamptz null, add column if not exists "handover_alerted_at" timestamptz null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "reached", drop column if exists "payout_eligible_at", drop column if exists "handover_alerted_at";`);
  }

}
