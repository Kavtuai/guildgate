import { Client, GatewayIntentBits } from "discord.js";
import { createDiscordJsGuildAdapter } from "@kavtuai/guildgate/discordjs";
import { createDiscordJsBotCollector } from "@kavtuai/guildgate/analytics";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
export const guilds = createDiscordJsGuildAdapter(client);
export const botMetrics = createDiscordJsBotCollector(client);
