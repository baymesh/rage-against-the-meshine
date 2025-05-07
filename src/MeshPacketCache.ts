const MESHVIEW_BASE_URL = process.env.MESHVIEW_BASE_URL;

/**
 * Interface representing the data structure of a decoded packet.
 */
export interface Data {
  portnum: number;
  payload: Buffer;
  replyId?: number;
}

/**
 * Interface representing the structure of a mesh packet.
 */
export interface MeshPacket {
  from: number;
  to: number;
  channel: number;
  encrypted: Buffer;
  id: number;
  rxTime: number;
  rxSnr: number;
  hopLimit: number;
  wantAck: boolean;
  rxRssi: number;
  hopStart: number;
  decoded: Data;
}

/**
 * Interface representing the structure of a service envelope.
 */
export interface ServiceEnvelope {
  packet: MeshPacket;
  mqttTime: Date;
  channelId: string;
  gatewayId: string;
  topic: string;
  mqttServer: string;
}

/**
 * Interface representing a group of packets.
 */
export interface PacketGroup {
  id: number;
  time: Date;
  rxTime: number;
  dirty: boolean;
  serviceEnvelopes: ServiceEnvelope[];
}

// Enums matching the proto definition
export enum LocSource {
  LOC_UNSET = 0,
  LOC_MANUAL = 1,
  LOC_INTERNAL = 2,
  LOC_EXTERNAL = 3,
}

export enum AltSource {
  ALT_UNSET = 0,
  ALT_MANUAL = 1,
  ALT_INTERNAL = 2,
  ALT_EXTERNAL = 3,
  ALT_BAROMETRIC = 4,
}

// TypeScript interface for the raw decoded Position message.
// Field names are in camelCase as output by protobufjs.
export interface DecodedPosition {
  latitudeI?: number;
  longitudeI?: number;
  altitude?: number;
  time: number;
  locationSource: LocSource;
  altitudeSource: AltSource;
  timestamp: number;
  timestampMillisAdjust: number;
  altitudeHae?: number;
  altitudeGeoidalSeparation?: number;
  PDOP: number;
  HDOP: number;
  VDOP: number;
  gpsAccuracy: number;
  groundSpeed?: number;
  groundTrack?: number;
  fixQuality: number;
  fixType: number;
  satsInView: number;
  sensorId: number;
  nextUpdate: number;
  seqNumber: number;
  precisionBits: number;
}

/**
 * Converts a decoded position object to a string representation.
 * @param pos The decoded position object.
 * @returns A string representation of the position.
 */
export function decodedPositionToString(pos: DecodedPosition): string {
  const parts: string[] = [];

  parts.push(`Time: ${new Date(pos.time * 1000).toISOString()}`);
  parts.push(`Location Source: ${LocSource[pos.locationSource]}`);
  parts.push(`Altitude Source: ${AltSource[pos.altitudeSource]}`);

  if (pos.altitudeHae !== undefined && pos.altitudeHae !== null) {
    parts.push(`Altitude HAE: ${pos.altitudeHae} m`);
  }

  if (
    pos.altitudeGeoidalSeparation !== undefined &&
    pos.altitudeGeoidalSeparation !== null
  ) {
    parts.push(`Geoidal Separation: ${pos.altitudeGeoidalSeparation} m`);
  }

  if ("PDOP" in pos && pos.PDOP !== 0) parts.push(`PDOP: ${pos.PDOP}`);
  if ("HDOP" in pos && pos.HDOP !== 0) parts.push(`HDOP: ${pos.HDOP}`);
  if ("VDOP" in pos && pos.VDOP !== 0) parts.push(`VDOP: ${pos.VDOP}`);
  if ("gpsAccuracy" in pos && pos.gpsAccuracy !== 0)
    parts.push(`GPS Accuracy: ${pos.gpsAccuracy} mm`);

  if (pos.groundSpeed !== undefined && pos.groundSpeed !== null) {
    parts.push(`Ground Speed: ${pos.groundSpeed} m/s`);
  }

  if (pos.groundTrack !== undefined && pos.groundTrack !== null) {
    parts.push(`Ground Track: ${(pos.groundTrack / 100).toFixed(2)}°`);
  }

  if ("fixQuality" in pos && pos.fixQuality !== 0)
    parts.push(`Fix Quality: ${pos.fixQuality}`);
  if ("fixType" in pos && pos.fixType !== 0)
    parts.push(`Fix Type: ${pos.fixType}`);
  if ("satsInView" in pos && pos.satsInView !== 0)
    parts.push(`Satellites in View: ${pos.satsInView}`);
  if ("precisionBits" in pos && pos.precisionBits !== 0)
    parts.push(`Precision Bits: ${pos.precisionBits}`);

  return parts.join("\n");
}

/**
 * Class representing a cache for mesh packets.
 */
class MeshPacketCache {
  private queue: PacketGroup[];
  private static readonly ONE_HOUR_MS = 60 * 60 * 1000;

  constructor() {
    this.queue = [];
  }

  /**
   * Checks if a packet with the given ID exists in the cache.
   * @param packetId The ID of the packet.
   * @returns True if the packet exists, false otherwise.
   */
  exists(packetId: number): boolean {
    return this.queue.some((packetGroup) => packetGroup.id === packetId);
  }

  /**
   * Gets the index of a packet group with the given ID.
   * @param packetId The ID of the packet.
   * @returns The index of the packet group, or -1 if not found.
   */
  getIndex(packetId: number): number {
    return this.queue.findIndex((packetGroup) => packetGroup.id === packetId);
  }

  /**
   * Adds a service envelope to the cache.
   * @param serviceEnvelope The service envelope to add.
   * @param topic The MQTT topic.
   * @param mqttServer The MQTT server.
   */
  add(serviceEnvelope: ServiceEnvelope, topic: string, mqttServer: string) {
    serviceEnvelope.mqttTime = new Date();
    serviceEnvelope.topic = topic;
    serviceEnvelope.mqttServer = mqttServer;
    const groupIndex = this.getIndex(serviceEnvelope.packet.id);
    if (groupIndex === -1) {
      this.queue.push({
        id: serviceEnvelope.packet.id,
        time: serviceEnvelope.mqttTime,
        rxTime: serviceEnvelope.packet.rxTime,
        dirty: true,
        serviceEnvelopes: [serviceEnvelope],
      });
    } else {
      this.queue[groupIndex].serviceEnvelopes.push(serviceEnvelope);
      this.queue[groupIndex].dirty = true;
    }
  }

  /**
   * Gets the packet groups that are marked as dirty.
   * @returns An array of dirty packet groups.
   */
  getDirtyPacketGroups(): PacketGroup[] {
    const dirtyPacketGroups = this.queue.filter(
      (packetGroup) => packetGroup.dirty,
    );
    dirtyPacketGroups.forEach((packetGroup) => {
      packetGroup.dirty = false;
    });
    const oneHourAgo = new Date(Date.now() - MeshPacketCache.ONE_HOUR_MS);
    this.queue = this.queue.filter(
      (packetGroup) => packetGroup.time.getTime() >= oneHourAgo.getTime(),
    );
    return dirtyPacketGroups;
  }

  /**
   * Gets the size of the cache.
   * @returns The number of packet groups in the cache.
   */
  size(): number {
    return this.queue.length;
  }
}

export default MeshPacketCache;
