import { Client, GatewayIntentBits, Partials, Options } from "discord.js";

const SUPABASE_URL = "https://dipqvdraxxvgugzrmjvx.supabase.co";
const SB_SECRET_KEY = process.env.SB_SECRET_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ADMIN_DISCORD_USER_ID = process.env.ADMIN_DISCORD_USER_ID; // Nat's Discord user ID, gets DMed when a new channel appears

if (!SB_SECRET_KEY || !DISCORD_BOT_TOKEN) {
  console.error("Missing SB_SECRET_KEY or DISCORD_BOT_TOKEN environment variables. Set both in the JustRunMy panel before starting.");
  process.exit(1);
}
if (!ADMIN_DISCORD_USER_ID) {
  console.warn("ADMIN_DISCORD_USER_ID not set, new-channel notifications are disabled, everything else still works fine.");
}

// Kept deliberately minimal: only the intents actually needed, and caching
// turned off wherever possible, this is what keeps a discord.js bot livable
// inside 256MB instead of ballooning with guild/member/message caches it
// never uses.
// Selective, not blanket: kill the caches that actually cost memory and
// that this bot never reads back (message history, reactions, presence),
// leave the structural managers (guild, role, permission-overwrite) at
// their normal defaults, disabling those broke internal permission
// resolution per discord.js's own warning.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    ReactionManager: 0,
    PresenceManager: 0,
    ThreadManager: 0,
    GuildStickerManager: 0,
    GuildEmojiManager: 0,
  }),
});

async function writeToRawComms({ sender, recipient, body, metadata }) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/raw_comms`, {
      method: "POST",
      headers: {
        apikey: SB_SECRET_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source: "discord",
        sender,
        recipient,
        body,
        metadata,
      }),
    });
    if (!res.ok) {
      console.error("Failed to write to raw_comms:", res.status, await res.text());
    }
  } catch (e) {
    console.error("raw_comms write error:", e);
  }
}

client.on("clientReady", () => {
  console.log(`Gateway bot online as ${client.user.tag}, listening for ambient messages.`);
});

client.on("messageCreate", async (message) => {
  // ignore bots (including itself) and slash-command interactions,
  // those already go through the discord-interactions Edge Function
  if (message.author.bot) return;
  if (!message.content || message.content.trim().length === 0) return;

  await writeToRawComms({
    sender: message.author.username,
    recipient: message.channel?.name ?? message.channelId,
    body: message.content,
    metadata: {
      guild_id: message.guildId,
      channel_id: message.channelId,
      message_id: message.id,
      timestamp: message.createdAt.toISOString(),
    },
  });
});

// New channel created anywhere in the server, DM the admin so it can get
// added to DISCORD_PROJECT_CHANNELS or DISCORD_PRIVATE_CHANNELS, without
// them needing to go digging for the ID themselves.
client.on("channelCreate", async (channel) => {
  if (!ADMIN_DISCORD_USER_ID) return;
  if (!channel.guild) return; // ignore DM channels, only care about server channels

  try {
    const admin = await client.users.fetch(ADMIN_DISCORD_USER_ID);
    await admin.send(
      `**New channel created:** #${channel.name}\n` +
      `Channel ID: \`${channel.id}\`\n` +
      `Guild ID: \`${channel.guildId}\`\n\n` +
      `Add this to the discord_channels table if it should be tracked (project channel or private pair).`
    );
  } catch (e) {
    console.error("Failed to DM admin about new channel:", e);
  }
});

client.on("error", (e) => console.error("Discord client error:", e));

client.login(DISCORD_BOT_TOKEN);
