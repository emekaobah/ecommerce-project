import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// A refund that needs the buyer's bank account (#13): when Paystack said so, when it was handed
// to Oja's team, and the bank and last 4 digits of the account it was retried to.
export class Migration20261017161300 extends Migration {

  override up(): void {
    this.addSql(`alter table if exists "order_refund" add column if not exists "needs_attention_at" timestamptz null, add column if not exists "handed_over_at" timestamptz null, add column if not exists "account_bank_name" text null, add column if not exists "account_last4" text null;`);
  }

  override down(): void {
    this.addSql(`alter table if exists "order_refund" drop column if exists "needs_attention_at", drop column if exists "handed_over_at", drop column if exists "account_bank_name", drop column if exists "account_last4";`);
  }

}
