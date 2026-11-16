import { clientNetwork, memoryRateLimitStore } from "../lib/rate-limit"

describe("memoryRateLimitStore", () => {
  it("counts each key's hits in its window apart from every other key's", async () => {
    const store = memoryRateLimitStore(() => 0)

    expect([await store.hit("a", 60), await store.hit("a", 60), await store.hit("b", 60), await store.hit("a", 60)]).toEqual([1, 2, 1, 3])
  })

  it("starts a key's count again once its window is over", async () => {
    let now = 0
    const store = memoryRateLimitStore(() => now)
    await store.hit("a", 60)
    await store.hit("a", 60)

    now = 59_999
    expect(await store.hit("a", 60)).toBe(3)
    now = 60_000
    expect(await store.hit("a", 60)).toBe(1)
  })
})

describe("clientNetwork", () => {
  it("keeps an IPv4 address, and unwraps one mapped into IPv6", () => {
    expect(clientNetwork("203.0.113.7")).toBe("203.0.113.7")
    expect(clientNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7")
  })

  it("takes an IPv6 address's /64, however it is written", () => {
    expect(clientNetwork("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64")
    expect(clientNetwork("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64")
    expect(clientNetwork("2001:DB8::1")).toBe("2001:db8:0:0::/64")
    expect(clientNetwork("::1")).toBe("0:0:0:0::/64")
  })
})
