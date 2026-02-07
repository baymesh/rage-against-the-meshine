# Rage Against the Meshine

![ratm2_demo](https://github.com/user-attachments/assets/a9c1fab9-2bc8-462b-8c41-18d092704b79)

A Discord bot for Meshtastic network integration. It bridges Meshtastic MQTT traffic into Discord channels and supports multiple meshes in a single instance. It is the successor to the original bot: https://github.com/baymesh/ratm-meshtastic-discord-bot

## Project Overview

Rage Against the Meshine is a TypeScript application that bridges Meshtastic mesh networks with Discord. It monitors MQTT topics for Meshtastic packet data, processes text and position packets, and forwards messages to Discord channels based on routing rules. The application also provides Discord commands for managing nodes, tracking devices, and moderating the network.

## Features

- Text messaging bridge from Meshtastic to Discord
- Position updates for tracker and balloon nodes
- Node management commands to link and unlink nodes
- Moderation commands to ban and unban nodes
- Multi mesh support with per mesh MQTT and Discord clients

## Technology Stack

- TypeScript
- Discord.js
- MQTT
- Redis
- Protobuf
- Docker

## Getting Started

### Prerequisites

- Node.js v20 or later
- Redis server
- MQTT broker with access to Meshtastic network data
- Discord bot token and application ID
- Discord server (guild) with appropriate channels set up

### Configuration

Runtime configuration is loaded from config.json and optional secrets.json.

config.json (example):
```json
{
   "environment": "prod",
   "nodeInfoUpdates": true,
   "meshes": [
      {
         "id": "baymesh",
         "name": "Bay Area Mesh",
         "meshViewBaseUrl": "https://meshview.bayme.sh",
         "mqtt": {
            "brokerUrl": "mqtt://broker1:1883",
            "topics": ["msh/US/#"]
         },
         "discord": {
            "clientId": "abc123",
            "guildId": "1234567890"
         },
         "routing": {
            "channelRegex": [
               { "pattern": "LongFast", "discordChannelId": "123" },
               { "pattern": "MediumFast", "discordChannelId": "456" },
               { "pattern": "MediumSlow", "discordChannelId": "789" },
               { "pattern": "^Test$", "discordChannelId": "234" },
               { "pattern": "HAB", "discordChannelId": "345" }
            ]
         }
      }
   ]
}
```

secrets.json (example):
```json
{
   "meshes": [
      {
         "id": "baymesh",
         "discordToken": "def456"
      }
   ]
}
```

Notes:
- CONFIG_PATH and SECRETS_PATH can override default file locations.
- Routing rules are regex matches against Meshtastic channelId. First match wins.
- meshViewBaseUrl is set per mesh to generate links.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CONFIG_PATH` | Path to config.json (optional) |
| `SECRETS_PATH` | Path to secrets.json (optional) |
| `REDIS_URL` | Redis URL |
| `MQTT_BROKER_URL` | MQTT broker URL (legacy fallback) |
| `MQTT_TOPICS` | JSON array of MQTT topics (legacy fallback) |
| `DISCORD_TOKEN` | Discord token (legacy fallback) |
| `DISCORD_CLIENT_ID` | Discord client id (legacy fallback) |
| `DISCORD_GUILD` | Discord guild id (legacy fallback) |
| `DISCORD_CHANNEL_LF` | LongFast channel id (legacy fallback) |
| `DISCORD_CHANNEL_MF` | MediumFast channel id (legacy fallback) |
| `DISCORD_CHANNEL_MS` | MediumSlow channel id (legacy fallback) |
| `DISCORD_CHANNEL_MF_TEST` | Test channel id (legacy fallback) |
| `DISCORD_CHANNEL_HAB` | HAB channel id (legacy fallback) |
| `ENVIRONMENT` | Deployment environment (production or development) |
| `NODE_INFO_UPDATES` | Enable node info updates (1 or 0) |
| `MESHVIEW_BASE_URL` | Meshview base URL (legacy fallback) |

### Installation

#### Using Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/baymesh/rage-against-the-meshine-nextgen.git
   cd rage-against-the-meshine-nextgen
   ```

2. Create config.json and secrets.json:
   
   see above

3. Start the application with Docker Compose:
   ```bash
   docker-compose up -d
   ```

#### Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/baymesh/rage-against-the-meshine-nextgen.git
   cd rage-against-the-meshine-nextgen
   ```

2. Clone the Meshtastic protobufs repository:
   ```bash
   git clone https://github.com/meshtastic/protobufs.git src/protobufs
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Set up config.json and secrets.json as described above

5. Start the application:
   ```bash
   npx tsx index.ts
   ```

## Discord Commands

The bot provides the following Discord slash commands:

| Command | Description | Required Role | Options |
|---------|-------------|--------------|---------|
| `/linknode` | Link a Meshtastic node to your Discord user | Any | `nodeid`: The hex or integer node ID to link |
| `/unlinknode` | Unlink a node from your Discord user | Any | `nodeid`: The hex or integer node ID to unlink |
| `/addtracker` | Mark a node as a tracker for position updates | Moderator, Admin | `nodeid`: The hex or integer node ID to track |
| `/removetracker` | Remove a node from the tracker list | Moderator, Admin | `nodeid`: The hex or integer node ID to stop tracking |
| `/addballoon` | Mark a node as a balloon for position updates | Moderator, Admin | `nodeid`: The hex or integer node ID to track |
| `/removeballoon` | Remove a node from the balloon list | Moderator, Admin | `nodeid`: The hex or integer node ID to stop tracking |
| `/bannode` | Ban a node from the bridge | Moderator, Admin | `nodeid`: The node ID to ban |
| `/unbannode` | Unban a node from the bridge | Moderator, Admin | `nodeid`: The node ID to unban |

## Project Structure

```
rage-against-the-meshine-nextgen/
├── .github/              # GitHub workflow configurations
├── src/                  # Source code
│   ├── protobufs/        # Meshtastic protocol buffer definitions
│   ├── Commands.ts       # Discord slash command definitions
│   ├── DiscordMessageUtils.ts  # Utility functions for Discord messages
│   ├── DiscordUtils.ts   # Utility functions for Discord API
│   ├── FifoCache.ts      # First-in-first-out cache implementation
│   ├── Logger.ts         # Logging functionality
│   ├── MeshPacketCache.ts # Cache for Meshtastic packets
│   ├── MeshRedis.ts      # Redis interface for node data
│   ├── MessageUtils.ts   # Message processing utilities
│   ├── MqttUtils.ts      # MQTT message handling
│   ├── NodeUtils.ts      # Utility functions for node operations
│   └── decrypt.ts        # Decryption utilities for encrypted packets
├── .dockerignore
├── .gitignore
├── Dockerfile            # Docker build configuration
├── docker-compose.yml    # Docker Compose configuration
├── index.ts              # Application entry point
├── package.json          # Node.js package configuration
└── README.md             # Project documentation
```

## Architecture

1. **MQTT Client**: Subscribes to Meshtastic MQTT topics and receives packet data
2. **Packet Processing**: Decodes packets using protobuf definitions, handles different packet types
3. **Packet Cache**: Stores packets in memory for deduplication and message updates
4. **Redis Integration**: Stores persistent data about nodes, users, and configurations
5. **Discord Bot**: Sends processed messages to Discord channels and responds to commands

## Data Flow

1. Meshtastic nodes send packets over LoRa mesh network
2. Packets are forwarded to MQTT broker via Meshtastic gateways
3. This application receives packets via MQTT subscription
4. Packets are decoded, processed, and cached as needed
5. Messages are sent to appropriate Discord channels
6. Users can interact with the system via Discord commands

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Related Projects

- [ratm-meshtastic-discord-bot](https://github.com/baymesh/ratm-meshtastic-discord-bot) - My original discord bot, just simple webhooks
- [Meshtastic](https://meshtastic.org/) - Open source, off-grid, long-range mesh communication platform
- [Meshtastic Protobufs](https://github.com/meshtastic/protobufs) - Protocol buffer definitions for Meshtastic
