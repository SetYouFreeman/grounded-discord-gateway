import { Client, GatewayIntentBits, Partials, Options } from "discord.js";
import http from "http";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SB_SECRET_KEY = process.env.SB_SECRET_KEY;

if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SB_SECRET_KEY) {
  console.error("Missing required env vars. Set DISCORD_BOT_TOKEN, SUPABASE_URL, and SB_SECRET_KEY in the JustRunMy panel before starting.");
  process.exit(1);
}

// Kept deliberately minimal: only the intents actually needed, and caching
// turned off wherever possible, this is what keeps a discord.js bot livable
// inside 256MB instead of ballooning with guild/member/message caches it
// never uses.
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

client.on("error", (e) => console.error("Discord client error:", e));

client.login(DISCORD_BOT_TOKEN);

// --- Health check server ---
// This exists purely so an external cron service has something to hit.
// It has nothing to do with Discord or Supabase, it just proves the
// container is up and responding to inbound traffic, which is a much
// clearer "active" signal to JustRunMy than an outbound gateway socket.
// Register whatever PORT this listens on under Exposed Ports in the panel.
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok\n");
  })
  .listen(PORT, () => {
    console.log(`Health check server listening on port ${PORT}`);
  });
