import { Guild, GuildMember } from "discord.js";

export const fetchUserRoles = async (guild: Guild, userId: string): Promise<string[]> => {
  try {
    const member: GuildMember = await guild.members.fetch(userId);
    return member.roles.cache.map((role) => role.name);
  } catch (error) {
    console.error(`Failed to fetch user roles for user ${userId}:`, error);
    return [];
  }
};

export const fetchDiscordChannel = (guild: Guild, channelId: string) => {
  const channel = guild.channels.cache.find((ch) => ch.id === channelId && ch.isTextBased());
  if (!channel) {
    console.error(`Channel Id "${channelId}" not found`);
    return null;
  }
  //console.info(`Channel ${channel.name} found`);
  return channel;
};
