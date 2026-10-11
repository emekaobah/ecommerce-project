import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261011121340 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "order_fulfilment" add column if not exists "pickup_code" text null, add column if not exists "pickup_code_attempts" text[] null;`);
    // Every fulfilment carries its method now (#12); every order before pickup was delivered.
    this.addSql(`update "order_fulfilment" set "fulfilment" = jsonb_build_object('method', 'delivery') || "fulfilment" where not ("fulfilment" ? 'method');`);
  }

  override async down(): Promise<void> {
    this.addSql(`update "order_fulfilment" set "fulfilment" = "fulfilment" - 'method';`);
    this.addSql(`alter table if exists "order_fulfilment" drop column if exists "pickup_code", drop column if exists "pickup_code_attempts";`);
  }

}
