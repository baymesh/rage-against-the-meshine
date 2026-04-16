import { ApplicationCommandOptionType } from "discord.js";

const commands = [
  {
    name: "linknode",
    description:
      "Claim a node you own, and only ones you own, and link it to your discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to link",
        required: true,
      },
    ],
  },
  {
    name: "unlinknode",
    description: "Unlink a node from your discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The node hex ID to unlink",
        required: true,
      },
    ],
  },
  {
    name: "mylinkednodes",
    description: "List all nodes linked to your Discord account",
  },
  {
    name: "addtracker",
    description: "Start position updates from node in discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to start tracking",
        required: true,
      },
    ],
  },
  {
    name: "removetracker",
    description: "Stop position updates from node in discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to stop tracking",
        required: true,
      },
    ],
  },
  {
    name: "addballoon",
    description: "Start position updates from node in discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to start tracking",
        required: true,
      },
    ],
  },
  {
    name: "removeballoon",
    description: "Stop position updates from node in discord",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to stop tracking",
        required: true,
      },
    ],
  },
  {
    name: "bannode",
    description: "Ban a node from logger",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The node ID to ban",
        required: true,
      },
    ],
  },
  {
    name: "unbannode",
    description: "Unban a node from logger",
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The node ID to unban",
        required: true,
      },
    ],
  },
];

export default commands;
