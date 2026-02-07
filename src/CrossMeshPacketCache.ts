import { nodeId2hex } from "./NodeUtils";
import type { ServiceEnvelope } from "./MeshPacketCache";

export type CrossMeshServiceEnvelope = ServiceEnvelope & {
  meshId: string;
  gatewayMeshId: string;
};

export type CrossMeshPacketGroup = {
  key: string;
  id: number;
  from: string;
  time: Date;
  rxTime: number;
  updatedAt: Date;
  dirtyMeshes: Set<string>;
  meshIds: Set<string>;
  serviceEnvelopes: CrossMeshServiceEnvelope[];
};

class CrossMeshPacketCache {
  private groups: Map<string, CrossMeshPacketGroup>;
  private static readonly MERGE_WINDOW_MS = 10 * 60 * 1000;

  constructor() {
    this.groups = new Map();
  }

  private buildKey(packetId: number, from: string) {
    return `${packetId}:${from}`;
  }

  exists(packetId: number, from: string): boolean {
    return this.groups.has(this.buildKey(packetId, from));
  }

  add(
    serviceEnvelope: ServiceEnvelope,
    topic: string,
    mqttServer: string,
    meshId: string,
  ) {
    const now = new Date();
    serviceEnvelope.mqttTime = now;
    serviceEnvelope.topic = topic;
    serviceEnvelope.mqttServer = mqttServer;

    const from = nodeId2hex(serviceEnvelope.packet.from);
    const key = this.buildKey(serviceEnvelope.packet.id, from);

    const envelopeWithMesh = serviceEnvelope as CrossMeshServiceEnvelope;
    envelopeWithMesh.meshId = meshId;
    envelopeWithMesh.gatewayMeshId = meshId;

    const existing = this.groups.get(key);
    if (!existing) {
      this.groups.set(key, {
        key,
        id: serviceEnvelope.packet.id,
        from,
        time: now,
        rxTime: serviceEnvelope.packet.rxTime,
        updatedAt: now,
        dirtyMeshes: new Set([meshId]),
        meshIds: new Set([meshId]),
        serviceEnvelopes: [envelopeWithMesh],
      });
      return;
    }

    existing.serviceEnvelopes.push(envelopeWithMesh);
    existing.meshIds.add(meshId);
    existing.updatedAt = now;
    existing.dirtyMeshes = new Set(existing.meshIds);
  }

  getDirtyPacketGroups(meshId: string): CrossMeshPacketGroup[] {
    const results: CrossMeshPacketGroup[] = [];
    for (const group of this.groups.values()) {
      if (!group.meshIds.has(meshId)) {
        continue;
      }
      if (group.dirtyMeshes.has(meshId)) {
        group.dirtyMeshes.delete(meshId);
        results.push(group);
      }
    }
    this.cleanup();
    return results;
  }

  private cleanup() {
    const cutoff = Date.now() - CrossMeshPacketCache.MERGE_WINDOW_MS;
    for (const [key, group] of this.groups.entries()) {
      if (group.updatedAt.getTime() < cutoff) {
        this.groups.delete(key);
      }
    }
  }
}

export default CrossMeshPacketCache;
