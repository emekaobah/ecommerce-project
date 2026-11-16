# 20. Popular searches are limited by network address, not by proof of a phone

Status: accepted, 2026-11-16 (#132).

## Context

Popular on Oja lists a term once at least 5 different phones have searched it in 14 days (#124). The phone id is a random UUID that the app makes and keeps in SecureStore, so nothing stops one script from inventing 5 ids. It could put any term onto the list, as long as the term isn't blocklisted and still finds listings. No route in the repo was rate-limited.

One option was a phone id issued by the server, signed so it can't be made up. A script can still ask for 5 of them from one machine, though. And it would need a new endpoint and a buyer-app release, all for little gain.

## Decision

- `POST /store/searches` stays open to guests, and the phone id stays app-made. The buyer app doesn't change.
- `recordSearch` takes the request's network address (`req.ip`; Medusa trusts one proxy hop, which is Railway's edge) and applies two limits after checking the region. An IPv6 address is taken as its /64 (`clientNetwork`), since a phone or home is given the whole block and could otherwise step through it:
  - at most **30 searches an hour** from one address;
  - **one address counts as one phone towards a term** (per region, normalised) for the 14-day popular window.
- The hourly limit is checked first, so a search it turns away doesn't use up the address's count for that term.
- A search over a limit gets a 200 with `recorded: false` and isn't kept. It isn't refused with a 429: the app ignores the answer anyway, and a script can't easily tell it is being limited.
- The limits use a reusable fixed-window limiter, `withinRateLimit` in `src/lib/rate-limit.ts`:
  - it counts in Redis when `redisUrl` is set (production), so the server and the worker share the counts, and in process memory otherwise;
  - keys are stored as SHA-256 hashes, so no address is kept;
  - if Redis can't be reached, it lets the hit through and logs a warning;
  - it opens its own `ioredis` client rather than going through a Medusa module. Medusa's cache and locking modules only get and set, with no atomic increment. A get-then-set would let parallel requests through together.

## Consequences

- Making a term popular now takes 5 different addresses, not one script.
- Buyers who share an address (a carrier's NAT, an office's Wi-Fi) count as one phone towards a term, which may slow a genuinely popular term in a busy place. Repeat searches of a term from one address aren't recorded either. They only ever broke ties, and the count is of different phones.
- Someone with many addresses (a botnet, rotating proxies) can still push a term. The blocklist and the listing check still apply, and the next step would be requiring a signed-in buyer for a search to count.
