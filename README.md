# Rage Against the Meshine

![ratm2_demo](https://github.com/user-attachments/assets/a9c1fab9-2bc8-462b-8c41-18d092704b79)

A Discord bot for Meshtastic network integration, enabling communication between Meshtastic mesh networks and Discord channels. It is the sucessor to the original bot: https://github.com/baymesh/ratm-meshtastic-discord-bot

## 📝 Project Overview

Rage Against the Meshine is a TypeScript application that bridges Meshtastic mesh networks with Discord. It monitors MQTT topics for Meshtastic packet data, processes various packet types (position, text messages), and forwards communications to designated Discord channels. The application also provides Discord commands for managing nodes, tracking devices, and moderating the network.

## ✨ Features

- **Text Messaging**: Bridge text messages between Meshtastic nodes and Discord channels
- **Position Tracking**: Track and display position updates from designated tracker and balloon nodes
- **Node Management**: Link/unlink Meshtastic nodes to Discord users
- **Moderation Tools**: Ban/unban problematic nodes from the bridge
- **Tracker and Balloon Node Designation**: Special handling for tracking devices and high-altitude balloon payloads

## 🛠️ Technology Stack

- **TypeScript**: Main programming language
- **Discord.js**: Discord API integration
- **MQTT**: Message broker for receiving Meshtastic packets
- **Redis**: Persistent storage for node information and configuration
- **Protobuf**: Data serialization for Meshtastic packets
- **Docker**: Containerization for deployment

## 🚀 Getting Started

### Prerequisites

- Node.js v20 or later
- Redis server
- MQTT broker with access to Meshtastic network data
- Discord bot token and application ID
- Discord server (guild) with appropriate channels set up

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Discord bot authentication token |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_GUILD` | Discord server (guild) ID |
| `DISCORD_CHANNEL_LF` | Discord channel ID for LongFast modem messages |
| `DISCORD_CHANNEL_MS` | Discord channel ID for MediumSlow modem messages |
| `DISCORD_CHANNEL_HAB` | Discord channel ID for High Altitude Balloon messages |
| `MQTT_BROKER_URL` | URL to the MQTT broker |
| `MQTT_USERNAME` | Username for the MQTT broker |
| `MQTT_PASSWORD` | Password for the MQTT broker |
| `MQTT_TOPICS` | JSON array of MQTT topics to subscribe to |
| `REDIS_URL` | URL to the Redis server |
| `ENVIRONMENT` | Deployment environment (e.g., "production", "development") |
| `NODE_INFO_UPDATES` | Enable/disable node information updates (1 or 0) |

### Installation

#### Using Docker (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/baymesh/rage-against-the-meshine-nextgen.git
   cd rage-against-the-meshine-nextgen
   ```

2. Create a `.env` file with the required environment variables:
   ```
   DISCORD_TOKEN=your_discord_token
   DISCORD_CLIENT_ID=your_client_id
   DISCORD_GUILD=your_guild_id
   DISCORD_CHANNEL_LF=your_lf_channel_id
   DISCORD_CHANNEL_MS=your_ms_channel_id
   DISCORD_CHANNEL_HAB=your_hab_channel_id
   MQTT_BROKER_URL=mqtt://your-broker-url:1883
   MQTT_TOPICS=["msh/US/topic1", "msh/US/topic2"]
   REDIS_URL=redis://your-redis-url:6379
   ENVIRONMENT=production
   NODE_INFO_UPDATES=1
   ```

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

4. Set up environment variables as described above

5. Start the application:
   ```bash
   npx tsx index.ts
   ```

## 💬 Discord Commands

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

## 🗃️ Project Structure

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

## 📡 Architecture

1. **MQTT Client**: Subscribes to Meshtastic MQTT topics and receives packet data
2. **Packet Processing**: Decodes packets using protobuf definitions, handles different packet types
3. **Packet Cache**: Stores packets in memory for deduplication and message updates
4. **Redis Integration**: Stores persistent data about nodes, users, and configurations
5. **Discord Bot**: Sends processed messages to Discord channels and responds to commands

## 🔄 Data Flow

1. Meshtastic nodes send packets over LoRa mesh network
2. Packets are forwarded to MQTT broker via Meshtastic gateways
3. This application receives packets via MQTT subscription
4. Packets are decoded, processed, and cached as needed
5. Messages are sent to appropriate Discord channels
6. Users can interact with the system via Discord commands

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Related Projects

- [ratm-meshtastic-discord-bot](https://github.com/baymesh/ratm-meshtastic-discord-bot) - My original discord bot, just simple webhooks
- [Meshtastic](https://meshtastic.org/) - Open source, off-grid, long-range mesh communication platform
- [Meshtastic Protobufs](https://github.com/meshtastic/protobufs) - Protocol buffer definitions for Meshtastic
