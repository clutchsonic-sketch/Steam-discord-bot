import 'dotenv/config';
import fetch from 'node-fetch';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';

const {
  DISCORD_TOKEN,
  GUILD_ID,
  NICKNAME_PREFIX = 'Steam Now',
  ROTATE_EVERY_SEC = 60,
  REFRESH_DATA_EVERY_SEC = 300
} = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let lines = ['Loading Steam charts…'];
let rotateIdx = 0;

// Try Valve charts endpoint; fallback to SteamCharts HTML.
// Keep refresh ~5 minutes to be respectful.
async function fetchTop5() {
  // Primary: Valve charts (undocumented public endpoint)
  try {
    const r = await fetch('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/');
    const j = await r.json();
    const ranks = j?.response?.ranks;
    if (Array.isArray(ranks) && ranks.length) {
      const top = ranks.slice(0, 5).map(x => ({
        rank: x.rank,
        name: x.name || x.app_name || `App ${x.appid}`,
        players: x.concurrent_in_game || x.peak_in_game || 0
      }));
      return top.map(t => `#${t.rank} ${t.name} — ${fmtPlayers(t.players)}`);
    }
  } catch (e) {
    // ignore, fall through
  }

  // Fallback: parse steamcharts.com/top (simple extraction)
  try {
    const r = await fetch('https://steamcharts.com/top', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const rows = [...html.matchAll(
      /<tr>\s*<td>\s*(\d+).*?<a href="\/app\/\d+">([^<]+)<\/a>.*?<td class="num">([\d,]+)<\/td>/gs
    )].slice(0, 5).map(m => ({
      rank: +m[1],
      name: m[2].trim(),
      players: +m[3].replace(/,/g, '')
    }));
    if (rows.length) return rows.map(t => `#${t.rank} ${t.name} — ${fmtPlayers(t.players)}`);
  } catch (e) {
    // ignore
  }

  return ['Unable to load Steam charts'];
}

function fmtPlayers(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

async function setPresence(line) {
  await client.user.setPresence({
    activities: [{ name: line, type: ActivityType.Watching }],
    status: 'online'
  });
}

async function maybeSetNickname(line) {
  // Only if you provided GUILD_ID and want nickname updates
  if (!GUILD_ID || !NICKNAME_PREFIX) return;
  try {
    const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
    const me = guild.members.me || await guild.members.fetchMe();
    const short = line.length > 24 ? line.slice(0, 24) + '…' : line;
    await me.setNickname(`${NICKNAME_PREFIX} • ${short}`).catch(() => {});
  } catch {
    // Missing permission or bad guild id
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const refresh = async () => {
    lines = await fetchTop5();
    rotateIdx = 0;
    await setPresence(lines[0]);
    await maybeSetNickname(lines[0]);
  };

  await refresh();
  setInterval(refresh, Number(REFRESH_DATA_EVERY_SEC) * 1000);

  setInterval(async () => {
    if (!lines.length) return;
    rotateIdx = (rotateIdx + 1) % lines.length;
    const line = lines[rotateIdx];
    await setPresence(line);
    await maybeSetNickname(line);
  }, Number(ROTATE_EVERY_SEC) * 1000);
});

client.login(DISCORD_TOKEN);
