import crypto from "node:crypto";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwarded)
      ? forwarded[0]
      : String(forwarded || "").split(",")[0]
    ).trim() ||
    String(req.headers["x-real-ip"] || "").trim() ||
    String(req.socket?.remoteAddress || "").trim();

  return ip.replace(/^::ffff:/, "");
}

function getCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function validAccessToken(req) {
  const secret = String(process.env.ACCESS_SECRET || "");
  if (!secret) return false;

  const ip = getClientIp(req);
  const token = getCookie(req, "sc_access");
  if (!ip || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expires, ipHash, signature] = parts;
  if (!Number.isInteger(Number(expires)) || Number(expires) <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expectedIpHash = crypto.createHash("sha256").update(ip).digest("hex");
  if (ipHash !== expectedIpHash) return false;

  const payload = `${expires}.${ipHash}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

function isHlsUrl(value) {
  return typeof value === "string" && /\.m3u8(?:[?#]|$)/i.test(value.trim());
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(english|eng|hindi|hin|tamil|tam|telugu|tel|kannada|kan|bengali|ben)\b/gi, " ")
    .replace(/\b(day|session)\s*\d+\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEnglish(item) {
  return /(?:^|[_\-\s])(eng|english)(?:$|[_\-\s])/i.test(
    `${item?.content_id || ""} ${item?.language || ""} ${item?.title || ""}`
  );
}

// Recover complete objects from a truncated SonyLIV JSON response.
function recoverMatchesArray(text) {
  const matchesKey = text.indexOf('"matches"');
  if (matchesKey === -1) return [];

  const arrayStart = text.indexOf("[", matchesKey);
  if (arrayStart === -1) return [];

  const objects = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart + 1; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        try {
          objects.push(JSON.parse(text.slice(objectStart, i + 1)));
        } catch {
          // Ignore only the malformed object.
        }
        objectStart = -1;
      }
      continue;
    }

    if (depth === 0 && char === "]") break;
  }

  return objects;
}

function parseM3uAttributes(text) {
  const attrs = {};
  const regex = /([\w-]+)="((?:\\"|[^"])*)"/g;
  let match;

  while ((match = regex.exec(text))) {
    attrs[match[1]] = match[2].replace(/\\"/g, '"');
  }

  return attrs;
}

function parseM3u(text, sourceName) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const meta = comma >= 0 ? line.slice(0, comma) : line;
      const title = comma >= 0 ? line.slice(comma + 1).trim() : "";
      const attrs = parseM3uAttributes(meta);

      pending = {
        title: cleanText(title || attrs["tvg-name"], sourceName === "fancode" ? "FanCode Live Event" : "SonyLIV Live Event"),
        tvg_id: cleanText(attrs["tvg-id"]),
        tvg_name: cleanText(attrs["tvg-name"]),
        tvg_logo: cleanText(attrs["tvg-logo"]),
        tvg_language: cleanText(attrs["tvg-language"]),
        group_title: cleanText(attrs["group-title"], sourceName === "fancode" ? "FanCode" : "SonyLIV"),
      };
      continue;
    }

    if (!pending || line.startsWith("#")) continue;

    // Strip IPTV player directives such as |User-Agent=... while retaining the media URL.
    const mediaUrl = line.split("|", 1)[0].trim();

    if (isHlsUrl(mediaUrl)) {
      entries.push({
        ...pending,
        stream_url: mediaUrl,
        source: sourceName,
        status: "LIVE",
      });
    }

    pending = null;
  }

  return entries;
}

const SOURCES = [
  // OLD / ORIGINAL FEEDS
  {
    name: "fancode_old",
    provider: "fancode",
    feed: "old",
    format: "json",
    url: "https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json",
  },
  {
    name: "sonyliv_old",
    provider: "sonyliv",
    feed: "old",
    format: "json",
    url: "https://github.com/drmlive/sliv-live-events/raw/refs/heads/main/sonyliv.json",
  },

  // NEW SPORTLINK PLAYLIST FEEDS
  {
    name: "fancode_new",
    provider: "fancode",
    feed: "new",
    format: "m3u",
    url: "https://raw.githubusercontent.com/sportlive18/playlist/main/fancode.m3u",
  },
  {
    name: "sonyliv_new",
    provider: "sonyliv",
    feed: "new",
    format: "m3u",
    url: "https://raw.githubusercontent.com/sportlive18/playlist/main/sonyliv.m3u",
  },

  // EXISTING OFFICIAL-EVENT METADATA SOURCES
  {
    name: "willow",
    provider: "willow",
    feed: "old",
    format: "json",
    url: "https://raw.githubusercontent.com/sportlive18/Willow-Cricbuzz-Prime-Video-Sport-Live-Event-Auto-Updated-Playlist/main/willow.json",
  },
  {
    name: "primesport",
    provider: "primesport",
    feed: "old",
    format: "json",
    url: "https://raw.githubusercontent.com/sportlive18/Willow-Cricbuzz-Prime-Video-Sport-Live-Event-Auto-Updated-Playlist/main/primesport.json",
  },
];

async function fetchSource(source) {
  try {
    const response = await fetch(`${source.url}?t=${Date.now()}`, {
      headers: {
        Accept: source.format === "m3u"
          ? "audio/x-mpegurl, application/vnd.apple.mpegurl, text/plain, */*"
          : "application/json",
      },
    });

    if (!response.ok) {
      return {
        ...source,
        available: false,
        error: `HTTP ${response.status}`,
        data: null,
      };
    }

    const text = await response.text();

    if (source.format === "m3u") {
      const entries = parseM3u(text, source.provider);
      return {
        ...source,
        available: entries.length > 0,
        error: entries.length > 0 ? null : "No HLS .m3u8 entries found",
        data: entries,
      };
    }

    try {
      return {
        ...source,
        available: true,
        error: null,
        data: JSON.parse(text),
      };
    } catch {
      if (source.provider === "sonyliv") {
        const recovered = recoverMatchesArray(text);
        if (recovered.length > 0) {
          return {
            ...source,
            available: true,
            error: "Upstream JSON truncated; recovered complete records",
            data: { matches: recovered },
          };
        }
      }

      return {
        ...source,
        available: false,
        error: "Invalid JSON from upstream source",
        data: null,
      };
    }
  } catch (error) {
    console.error(`${source.name} fetch error:`, error);
    return {
      ...source,
      available: false,
      error: "Network error",
      data: null,
    };
  }
}

function getItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Matches)) return data.Matches;
  if (Array.isArray(data?.matches)) return data.matches;
  if (Array.isArray(data?.events)) return data.events;
  return [];
}

function normalizeFanCodeOld(item) {
  if (String(item?.status || "").toUpperCase() !== "LIVE") return null;

  const streamUrl =
    item.stream_url ||
    item.video_url ||
    item.dai_url ||
    item.adfree_url ||
    item.streams?.primary ||
    item.auto_streams?.ENGLISH?.streams?.["1080p"] ||
    item.auto_streams?.ENGLISH?.streams?.["720p"] ||
    item.auto_streams?.ENGLISH?.streams?.["540p"] ||
    item.auto_streams?.ENGLISH?.streams?.["480p"] ||
    item.auto_streams?.ENGLISH?.streams?.["360p"] ||
    item.auto_streams?.ENGLISH?.streams?.["240p"] ||
    "";

  if (!isHlsUrl(streamUrl)) return null;

  return {
    title: cleanText(item.title || item.match_name || item.event_name, "FanCode Live Event"),
    stream_url: streamUrl.trim(),
    src_image: typeof item.src === "string" ? item.src : null,
    source: "fancode",
    feed: "old",
    category: cleanText(item.event_category, "Sports"),
    status: "LIVE",
    event_name: item.event_name || null,
    match_name: item.match_name || null,
    match_id: item.match_id || null,
    start_time: item.startTime || null,
    playable: true,
  };
}

function normalizeSonyOld(item) {
  if (item?.isLive !== true) return null;

  const streamUrl = item.dai_url || item.pub_url || item.video_url || "";
  if (!isHlsUrl(streamUrl)) return null;

  const rawId = cleanText(item.contentId);
  return {
    title: cleanText(item.match_name || item.event_name, "SonyLIV Live Event"),
    stream_url: streamUrl.trim(),
    src_image: typeof item.src === "string" ? item.src : null,
    source: "sonyliv",
    feed: "old",
    category: cleanText(item.event_category, "Sports"),
    status: "LIVE",
    event_name: item.event_name || null,
    match_name: item.match_name || null,
    content_id: rawId || null,
    broadcast_channel: item.broadcast_channel || null,
    language: item.audioLanguageName || null,
    playable: true,
  };
}

function normalizeM3uItem(item, provider) {
  if (!isHlsUrl(item?.stream_url)) return null;

  return {
    title: cleanText(item.title, provider === "fancode" ? "FanCode Live Event" : "SonyLIV Live Event"),
    stream_url: item.stream_url.trim(),
    src_image: item.tvg_logo || null,
    source: provider,
    feed: "new",
    category: cleanText(item.group_title, provider === "fancode" ? "FanCode" : "SonyLIV"),
    status: "LIVE",
    event_name: item.title || null,
    match_name: item.title || null,
    content_id: item.tvg_id || null,
    match_id: item.tvg_id || null,
    language: item.tvg_language || null,
    playable: true,
  };
}

function normalizeOfficialItem(item, source) {
  const isLive =
    String(item?.status || "").toUpperCase() === "LIVE" ||
    item?.isLive === true;
  if (!isLive) return null;

  const officialUrl = typeof item?.match_url === "string" ? item.match_url.trim() : "";
  if (!officialUrl) return null;

  const isWillow = source === "willow";
  return {
    title: cleanText(item.title || item.synopsis, isWillow ? "Willow Live Event" : "Prime Video Live Event"),
    stream_url: null,
    official_url: officialUrl,
    src_image: typeof item.cover_image === "string" ? item.cover_image : null,
    source,
    feed: "old",
    category: isWillow ? "Cricket" : "Sports",
    status: "LIVE",
    event_name: item.title || null,
    match_name: item.synopsis || item.title || null,
    match_id: item.match_id || null,
    start_time: item.time || null,
    playable: false,
  };
}

function mergeCandidates(candidates) {
  const byIdentity = new Map();

  for (const candidate of candidates) {
    if (!candidate) continue;

    const provider = candidate.source;
    const normalizedTitle = normalizeTitle(candidate.title);
    const language = cleanText(candidate.language).toLowerCase();
    const id = cleanText(candidate.content_id || candidate.match_id);

    // Exact stream URL is always a duplicate, even when it came from a different feed.
    const streamUrl = cleanText(candidate.stream_url).split("|", 1)[0];
    const exactKey = streamUrl
      ? `${provider}|url|${streamUrl}`
      : null;

    // For M3U/JSON copies of the same live event, title + language is the fallback identity.
    // This prevents old/new signed URLs from creating duplicate cards while retaining
    // genuinely different language variants.
    const identity = exactKey || `${provider}|event|${id || normalizedTitle}|${language}`;
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, candidate);
      continue;
    }

    // New Sportlink playlist entries are preferred for the same event because their
    // signed HLS URL is sourced from the newer playlist. Keep useful old metadata.
    if (candidate.feed === "new" && existing.feed !== "new") {
      byIdentity.set(identity, {
        ...existing,
        ...candidate,
        src_image: candidate.src_image || existing.src_image || null,
        category: candidate.category || existing.category || "Sports",
      });
    }
  }

  // Second-pass title dedupe for old/new feeds when IDs differ but the event title is identical.
  const final = new Map();
  for (const candidate of byIdentity.values()) {
    if (!candidate.stream_url) {
      const key = `${candidate.source}|${normalizeTitle(candidate.title)}`;
      if (final.has(key)) continue;
      final.set(key, candidate);
      continue;
    }

    const titleKey = `${candidate.source}|${normalizeTitle(candidate.title)}|${cleanText(candidate.language).toLowerCase()}`;
    const existing = final.get(titleKey);
    if (!existing) {
      final.set(titleKey, candidate);
      continue;
    }

    if (candidate.feed === "new" && existing.feed !== "new") {
      final.set(titleKey, {
        ...existing,
        ...candidate,
        src_image: candidate.src_image || existing.src_image || null,
      });
    }
  }

  return [...final.values()];
}

export default async function handler(req, res) {
  if (!validAccessToken(req)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).json({
      status: "blocked",
      message: "Access verification required.",
    });
  }

  try {
    const results = await Promise.all(SOURCES.map(fetchSource));
    const matches = [];

    for (const result of results) {
      if (!result?.data) continue;
      const items = getItems(result.data);

      if (result.provider === "fancode") {
        for (const item of items) {
          const normalized = result.feed === "new"
            ? normalizeM3uItem(item, "fancode")
            : normalizeFanCodeOld(item);
          if (normalized) matches.push(normalized);
        }
      }

      if (result.provider === "sonyliv") {
        for (const item of items) {
          const normalized = result.feed === "new"
            ? normalizeM3uItem(item, "sonyliv")
            : normalizeSonyOld(item);
          if (normalized) matches.push(normalized);
        }
      }

      if (result.provider === "willow" || result.provider === "primesport") {
        for (const item of items) {
          const normalized = normalizeOfficialItem(item, result.provider);
          if (normalized) matches.push(normalized);
        }
      }
    }

    const uniqueMatches = mergeCandidates(matches);

    const sourceOrder = {
      fancode: 0,
      sonyliv: 1,
      willow: 2,
      primesport: 3,
    };

    uniqueMatches.sort((a, b) => {
      const sourceDiff = (sourceOrder[a.source] ?? 99) - (sourceOrder[b.source] ?? 99);
      if (sourceDiff !== 0) return sourceDiff;
      return a.title.localeCompare(b.title);
    });

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

    const sourceStatus = (provider) => {
      const providerResults = results.filter((r) => r?.provider === provider);
      return {
        available: providerResults.some((r) => r.available),
        error: providerResults.filter((r) => !r.available).map((r) => `${r.name}: ${r.error}`).join("; ") || null,
      };
    };

    res.status(200).json({
      status: "success",
      sources: {
        fancode: {
          ...sourceStatus("fancode"),
          old_available: results.find((r) => r.name === "fancode_old")?.available || false,
          new_available: results.find((r) => r.name === "fancode_new")?.available || false,
        },
        sonyliv: {
          ...sourceStatus("sonyliv"),
          old_available: results.find((r) => r.name === "sonyliv_old")?.available || false,
          new_available: results.find((r) => r.name === "sonyliv_new")?.available || false,
        },
        willow: sourceStatus("willow"),
        primesport: sourceStatus("primesport"),
      },
      count: uniqueMatches.length,
      matches: uniqueMatches,
    });
  } catch (error) {
    console.error("Streams API error:", error);
    res.status(500).json({
      status: "error",
      message: "Unable to load stream data",
    });
  }
}
