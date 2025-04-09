export interface Data {
  portnum: number;
  payload: Buffer;
  replyId?: number;
}

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

export interface ServiceEnvelope {
  packet: MeshPacket;
  mqttTime: Date;
  channelId: string;
  gatewayId: string;
  topic: string;
  mqttServer: string;
}

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
  // Optional: The new preferred location encoding (multiply by 1e-7 for degrees)
  latitudeI?: number;
  // Optional: The new preferred location encoding (multiply by 1e-7 for degrees)
  longitudeI?: number;
  // Optional: Altitude in meters above mean sea level
  altitude?: number;
  // Seconds since 1970 (typically provided by the phone)
  time: number;
  // How the location was acquired, as an enum value
  locationSource: LocSource;
  // How the altitude was acquired, as an enum value
  altitudeSource: AltSource;
  // Positional timestamp (actual GPS solution time) in epoch seconds
  timestamp: number;
  // Milliseconds adjustment for the timestamp
  timestampMillisAdjust: number;
  // Optional: HAE altitude in meters
  altitudeHae?: number;
  // Optional: Geoidal separation in meters
  altitudeGeoidalSeparation?: number;
  // Horizontal Dilution of Precision in 1/100 units
  PDOP: number;
  // Horizontal Dilution of Precision in 1/100 units
  HDOP: number;
  // Vertical Dilution of Precision in 1/100 units
  VDOP: number;
  // GPS hardware accuracy constant in mm
  gpsAccuracy: number;
  // Optional: Ground speed in m/s
  groundSpeed?: number;
  // Optional: True North track in 1/100 degrees
  groundTrack?: number;
  // GPS fix quality (e.g., from NMEA GxGGA)
  fixQuality: number;
  // GPS fix type (2D/3D)
  fixType: number;
  // Number of satellites in view
  satsInView: number;
  // Sensor ID (in case multiple positioning sensors are used)
  sensorId: number;
  // Estimated/expected time (in seconds) until the next update
  nextUpdate: number;
  // Sequence number to help detect lost updates
  seqNumber: number;
  // Indicates the bits of precision set by the sending node
  precisionBits: number;
}

export function decodedPositionToString(pos: DecodedPosition): string {
  const parts: string[] = [];

  // Latitude & Longitude (divide by 10,000,000 for degrees)
  // if (pos.latitudeI !== undefined) {
  //   parts.push(`Latitude: ${(pos.latitudeI / 10000000).toFixed(7)}°`);
  // }
  // if (pos.longitudeI !== undefined) {
  //   parts.push(`Longitude: ${(pos.longitudeI / 10000000).toFixed(7)}°`);
  // }

  // if (pos.altitude !== undefined) {
  //   parts.push(`Altitude: ${pos.altitude} m`);
  // }

  // Time is required (assuming it's in seconds since 1970)
  parts.push(`Time: ${new Date(pos.time * 1000).toISOString()}`);

  // Enums for location and altitude source (assuming they have a reverse mapping)
  parts.push(`Location Source: ${LocSource[pos.locationSource]}`);
  parts.push(`Altitude Source: ${AltSource[pos.altitudeSource]}`);

  // Timestamp of GPS solution
  // parts.push(`GPS Timestamp: ${new Date(pos.timestamp * 1000).toISOString()}`);

  // Only include millis adjustment if non-zero
  // if (pos.timestampMillisAdjust !== 0) {
  //   parts.push(`Timestamp Millis Adjust: ${pos.timestampMillisAdjust}`);
  // }

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
    // groundTrack is in 1/100 degrees, convert to degrees
    parts.push(`Ground Track: ${(pos.groundTrack / 100).toFixed(2)}°`);
  }

  if ("fixQuality" in pos && pos.fixQuality !== 0)
    parts.push(`Fix Quality: ${pos.fixQuality}`);
  if ("fixType" in pos && pos.fixType !== 0)
    parts.push(`Fix Type: ${pos.fixType}`);
  if ("satsInView" in pos && pos.satsInView !== 0)
    parts.push(`Satellites in View: ${pos.satsInView}`);
  // parts.push(`Sensor ID: ${pos.sensorId}`);
  // parts.push(`Next Update: ${pos.nextUpdate} s`);
  // parts.push(`Sequence Number: ${pos.seqNumber}`);
  if ("precisionBits" in pos && pos.precisionBits !== 0)
    parts.push(`Precision Bits: ${pos.precisionBits}`);

  return parts.join("\n");
}

class MeshPacketCache {
  queue: PacketGroup[];

  constructor() {
    this.queue = [];
  }

  exists(packetId: number): boolean {
    return this.queue.some((packetGroup) => packetGroup.id === packetId);
  }

  getIndex(packetId: number): number {
    return this.queue.findIndex((packetGroup) => packetGroup.id === packetId);
  }

  add(serviceEnvelope: ServiceEnvelope, topic: string, mqttServer: string) {
    serviceEnvelope.mqttTime = new Date();
    serviceEnvelope.topic = topic;
    serviceEnvelope.mqttServer = mqttServer;
    const grouptIndex = this.getIndex(serviceEnvelope.packet.id);
    if (grouptIndex === -1) {
      this.queue.push({
        id: serviceEnvelope.packet.id,
        time: serviceEnvelope.mqttTime,
        rxTime: serviceEnvelope.packet.rxTime,
        dirty: true,
        serviceEnvelopes: [serviceEnvelope],
      });
    } else {
      this.queue[grouptIndex].serviceEnvelopes.push(serviceEnvelope);
      this.queue[grouptIndex].dirty = true;
    }
  }

  getDirtyPacketGroups(): PacketGroup[] {
    const dirties = this.queue.filter((packetGroup) => packetGroup.dirty);
    dirties.forEach((packetGroup) => {
      packetGroup.dirty = false;
    });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.queue = this.queue.filter(
      (packetGroup) => packetGroup.time.getTime() >= oneHourAgo.getTime(),
    );
    return dirties;
  }

  size() {
    return this.queue.length;
  }
}

export default MeshPacketCache;
