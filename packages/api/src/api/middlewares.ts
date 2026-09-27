import { defineMiddlewares } from "@medusajs/medusa";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";

export default defineMiddlewares({
    routes: [
        // Before any store route's own auth check, so a Clerk session token reads as the customer.
        { matcher: "/store/*", middlewares: [clerkCustomerAuth] },
    ],
});
