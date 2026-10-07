# 6. Quick-add permissions

Status: accepted, 2026-10-05 (#38)

## Context

Quick-add lets a shop member scan a product the shop stocks and put it online from the vendor app. On a catalogue match they set the shop's price and stock, creating an offer; otherwise they photograph it and name it, proposing a new product.

The people holding the phone are fulfilment staff, who have the stock **Order Management** role (#12). Story 40 limits staff to order and fulfilment actions, so they can't change pricing.

Facts that shaped the decision (checked 2026-10-05):

- Mercur 2.3.5's Order Management role can read offers and products but has no `offer:create`, `offer:update` or `product:create`. It has `file:create` (uploads).
- Mercur's vendor offer routes check `offer:create` for `POST /vendor/offers` and `offer:update` for `POST /vendor/offers/:id`. Granting staff `offer:create` would open those routes too: Mercur's create takes any variant, price and stock, so staff could list anything at any price through the panel's API, not only what they scanned.
- Roles are seeded by Mercur (`ensureSellerDefaultRoles`) and shared by every shop. Changing a stock role changes it everywhere, and Seller Administration picks up every policy (`*`).
- Mercur records the creating member on every offer (`offer.created_by`).

The maintainer settled the staff question as option 2: staff may list new items through quick-add, but can't change existing offers, and the owner sees who added each offer in the web vendor panel.

## Decision

- **No stock role changes.** Order Management keeps its policies. Quick-add's routes (`GET /vendor/quick-add/:barcode`, `POST /vendor/quick-add`) declare no RBAC policy. A custom check (`src/api/vendor/quick-add/permissions.ts`) lets in members whose roles grant `offer:create` (owners, managers, inventory) or `fulfillment:create` (fulfilment staff), and refuses the rest (accounting, support) with `403`.
- **Quick-add only adds.** It creates an offer only for a variant the shop has no offer on. A barcode the shop already sells is refused for every member (`422`, "Your shop already sells …"), so a scan never silently changes a price. Owners and managers change prices and stock in the web vendor panel, where catalogue work stays (design: the vendor app is for fulfilment). Staff keep being refused Mercur's offer update and delete routes.
- **One quick-add of a barcode at a time.** The check for an existing offer and the create run under a lock on the barcode (Medusa's locking module), so two phones scanning the same item add it once; the second is told the shop already sells it.
- **What staff can set is narrow.** The route takes a barcode, a selling price, an optional stock count, and, for an unknown barcode, a name and one photo. The SKU is the barcode (numbered if the shop already uses it), the shipping profile and stock location are the shop's own. No cost price: costs stay with owners and managers (#37).
- **A product the catalogue lacks is a vendor proposal.** It goes through the same workflow as a shop's import row (`createImportedOfferWorkflow`): proposed product, queued for enrichment as a vendor's, offered by the shop. So it always lands in the admin queue unless a trusted source confirms it with an image and a category, and AI-drafted fields are flagged (#36). A barcode that is still in review can't be quick-added by another shop until it is published.
- **The photo is uploaded once.** The app sends it base64-encoded in the JSON body (the typed client speaks JSON), up to 10 MB of JPEG, PNG or WebP. The API stores it in our file storage and records it on the enrichment record as already stored, so enrichment keeps it instead of copying it again. Claude's draft reads it from there. If the quick-add then fails, the photo is deleted.
- **Attribution.** The offer keeps `created_by` (the member) and `metadata.added_with = "quick_add"`. `GET /vendor/offer-authors?product_id=` (policy `offer:read`) lists who added each of the shop's offers on a product. The web vendor panel's offer page shows "Added by <member>" with a Quick-add badge and a prompt to check the price and stock.

## Consequences

- Staff can put a product on sale at a price nobody else checked. That is the accepted trade-off; the owner sees it marked on the offer's page. A list of everything quick-added, and a notification to the owner, aren't built.
- The custom check names permissions, not role ids, so a shop-specific role with `fulfillment:create` can quick-add too. Changing who fulfils orders changes who can quick-add.
- Prices of existing offers can't be changed from the vendor app. If owners want that on the phone, it is a separate, owner-only route.
- A photo up to 10 MB travels as base64, a third larger. The app takes JPEGs at half quality to stay well under it; resizing on the phone would make uploads faster on slow networks.
