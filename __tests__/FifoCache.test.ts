import FifoCache from "../src/FifoCache";

describe("FifoCache", () => {
  it("stores and retrieves values", () => {
    const cache = new FifoCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.exists("c")).toBe(false);
  });

  it("evicts oldest entry when full", () => {
    const cache = new FifoCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.exists("a")).toBe(false);
    expect(cache.exists("b")).toBe(true);
    expect(cache.exists("c")).toBe(true);
  });

  it("updates existing keys without changing eviction order", () => {
    const cache = new FifoCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    cache.set("c", 3);

    expect(cache.exists("a")).toBe(false);
    expect(cache.exists("b")).toBe(true);
    expect(cache.exists("c")).toBe(true);
  });
});
