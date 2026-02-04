import MeshPacketCache from "../src/MeshPacketCache";

describe("MeshPacketCache", () => {
  it("adds and groups envelopes by packet id", () => {
    const cache = new MeshPacketCache();

    const envelopeA: any = { packet: { id: 1, rxTime: 123 } };
    const envelopeB: any = { packet: { id: 1, rxTime: 123 } };
    const envelopeC: any = { packet: { id: 2, rxTime: 456 } };

    cache.add(envelopeA, "msh/US/1", "broker-a");
    cache.add(envelopeB, "msh/US/1", "broker-a");
    cache.add(envelopeC, "msh/US/2", "broker-b");

    expect(cache.size()).toBe(2);
    const dirty = cache.getDirtyPacketGroups();
    expect(dirty).toHaveLength(2);
    const groupOne = dirty.find((group) => group.id === 1);
    expect(groupOne?.serviceEnvelopes).toHaveLength(2);
  });

  it("tracks existence and index lookup", () => {
    const cache = new MeshPacketCache();
    const envelope: any = { packet: { id: 42, rxTime: 123 } };

    expect(cache.exists(42)).toBe(false);
    expect(cache.getIndex(42)).toBe(-1);

    cache.add(envelope, "msh/US/1", "broker-a");

    expect(cache.exists(42)).toBe(true);
    expect(cache.getIndex(42)).toBeGreaterThanOrEqual(0);
  });

  it("marks groups clean after retrieval and drops old entries", () => {
    const cache = new MeshPacketCache();
    const envelope: any = { packet: { id: 1, rxTime: 123 } };

    cache.add(envelope, "msh/US/1", "broker-a");
    expect(cache.getDirtyPacketGroups()).toHaveLength(1);
    expect(cache.getDirtyPacketGroups()).toHaveLength(0);

    const expiryCache = new MeshPacketCache();
    const oldEnvelope: any = { packet: { id: 2, rxTime: 1 } };
    expiryCache.add(oldEnvelope, "msh/US/2", "broker-b");

    // Simulate old age beyond the 1 hour window.
    const groups = (expiryCache as any).queue as any[];
    groups[0].time = new Date(Date.now() - 2 * 60 * 60 * 1000);

    expiryCache.getDirtyPacketGroups();
    expect(expiryCache.size()).toBe(0);
  });
});
