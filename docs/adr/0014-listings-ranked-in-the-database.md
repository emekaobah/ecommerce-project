# 14. Listings ranked and paged in the database

Status: accepted, 2026-10-22 (#64, spec #56). Supersedes the in-memory consequence of ADR 0011.

## Context

ADR 0011 set the listing order: name match, distance band, ship time, exact distance, first listed, never by price; a shop with no pin last. It accepted that listings were "worked out in memory before paging (fine at v1 catalogue sizes)". Every feed, search, category and shop request loaded every live shop, every listable product and every offer, priced every offer through Mercur, sorted them in Node and then cut out one page. The wishlist asked for an unbounded page. Deals ran one promotion computation per listing on the page.

The Adire redesign's Home lists shops near the buyer, each with its top products (#65), and keeps loading as the buyer scrolls. That needs the same ranking over shops, with stable pages, and it must not grow with the catalogue.

The shop's pickup pin lived only in its seller address's `metadata` (JSON, owned by Mercur's seller module), where SQL could reach it only by parsing JSON in every row.

## Decision

- **Postgres filters, ranks and pages listings** (`lib/listing-ranking.ts`). `rankedListings` is one query, one row per listing (a shop's offers of a product), with the columns it ranks by: `relevance`, `band`, `leadtime_to_ship`, `exact_km`, `first_listed_at`, `first_offer_id`. `LISTING_ORDER` orders it the ADR 0011 way, with `first_offer_id` last so the order is total and pages never overlap or skip. Counts come from the same query. Only the page's offers are then loaded, priced by Mercur and given deals.
  - It reads the tables of several modules (offer, seller, seller address, product, product variant, sales channel and category links, pricing). Reads go to SQL only where `query.graph` can't do the job (see "Reads that go to SQL" below); everything else keeps to `query.graph`.
  - An offer counts only when its variant has a price in the region's currency that applies to it: no rules other than its own `offer_id` or the region. That is what Mercur's per-offer pricing finds, so counts match what the page shows.
  - Name match keeps its four grades (whole name, start of name, start of a word for every word, inside) in SQL. Live shops are still decided in code (`liveSellerIds`, per shop, not per product) and passed in.
- **Distance is a SQL haversine** over a copy of each shop's pickup pin. No PostGIS or other extension. The bands come from `DISTANCE_BANDS_KM` in `@oja/domain`. A shop with no pin has no band and ranks after every shop with one, as ADR 0011 says (the in-memory sort had put it in the furthest band).
- **The pin is copied into `shop_pin`** (our `shop-pin` module): latitude and longitude columns per shop. The pickup address's metadata stays the source. Every write of a pickup address runs Mercur's `updateSellerAddressWorkflow` (the onboarding checklist, the vendor and admin address routes, a new seller account, the seed), and a handler on its `addressUpdated` hook refreshes the copy, undone if the workflow rolls back. A migration copied the pins saved before.
- **Deals are worked out once per page**: one promotion computation over a cart holding every offer on the page, each item keeping only its own shop's promotions. A promotion whose conditions ask about anything other than the region, currency, sales channel or country gets no badge, since the shared cart would answer them for items it doesn't hold.
- **The wishlist asks for exactly its saved listings** (shop and product pairs), a page as long as the wishlist.
- `GET /store/shops` (#65) builds on `rankedListings` (`rankShopPage`): a window numbers each shop's listings in `LISTING_ORDER`, and a shop ranks where its first listing would come in the feed, so its ship time is its soonest listing's. Its top listings are its first few by that number, and its listing count the window's count. One row per shop, so shop pages never repeat or skip a shop. `GET /store/listings` also counts the shops its matches come from (`shop_count`), for search.

## Reads that go to SQL

`query.graph` reads one entity and what is linked to it, filtered on the entity's own fields. It can't filter on both sides of a link at once, order or page by a value worked out across modules, or group and aggregate. A read that needs one of those goes to Postgres through the shared connection (`PG_CONNECTION`), with its SQL builders in `lib/sql.ts` (`haversineKmSql`, `escapeLike`). These are all of them:

- **`lib/listing-ranking.ts`**: listings and shops ranked, filtered, counted and paged (above).
- **`lib/buyer-orders.ts`**: the buyer's order history pages their checkouts by grouping our `order_fulfilment` rows by order group, filtered by phase (#54). Its `q` search keeps a checkout with an item named like it, through the order module's `order_item` and `order_line_item` tables inside the same grouped query, so search pages like the rest of the list.
- **`lib/collection-point.ts`**: the distance from the buyer to each shop's collection point (#68), a haversine over our `collection_point` and `shop_pin` tables.
- **`lib/reviews.ts`**: a review has no author or target column, only Mercur's link tables to its customer, product and shop. The buyer's reviews of given shops and products filter both sides of those links at once (author and target), and a target's published reviews are averaged, counted and paged in the database.

Each reads only by joins and filters; writes always go through module services and workflows.

## Consequences

- A request costs a few indexed queries and pricing for one page, not the whole catalogue.
- Distances stay whole kilometres and no route returns a shop's coordinates (ADR 0011).
- `shop_pin` stores the pin as `real` (about a metre at Nigeria's latitudes), plenty for whole kilometres.
- A pickup address written without Mercur's workflow (straight through the seller module's service) would leave the copy stale. Nothing in the app does; new writers must use the workflow.
- The SQL reads depend on Medusa's and Mercur's table names. An upgrade that renames them breaks the listings, order history, checkout and reviews integration tests, which is where it would be caught.
- A promotion with a cart-level condition beyond the page-wide ones shows no deal badge, though it may still apply at checkout.
