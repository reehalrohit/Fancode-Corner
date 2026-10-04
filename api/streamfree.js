import crypto from "node:crypto";

const ACCESS_COOKIE = "sc_access";
const STREAMFREE_API = "https://streamfree.top/api/v1/streams";

const ALLOWED_HOSTS = new Set([
  "streamfree.top",
  "www.streamfree.top",
  "strmfree.st",
  "www.strmfree.st",
  "strmfree.link",
  "www.strmfree.link",
]);

const QUALITY_ORDER = ["720p", "540p", "1080p", "2160p"];

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
  const token = getCookie(req, ACCESS_COOKIE);

  if (!ip || !token) return false;

  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const [expires, ipHash, signature] = parts;

  if (
    !Number.isInteger(Number(expires)) ||
    Number(expires) <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expectedIpHash = crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex");

  if (ipHash !== expectedIpHash) return false;

  const payload = `${expires}.${ipHash}`;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function validAllowedUrl(value) {
  try {
    const url = new URL(String(value || ""));

    return (
      url.protocol === "https:" &&
      ALLOWED_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isHlsUrl(value) {
  return (
    typeof value === "string" &&
    /\.m3u8(?:$|[?#])/i.test(value.trim())
  );
}

function extractStreams(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.streams)) return data.streams;
  if (Array.isArray(data?.data?.streams)) return data.data.streams;
  if (Array.isArray(data?.data)) return data.data;

  if (
    data &&
    typeof data === "object" &&
    (data.stream_key || data.embed_url || data.id)
  ) {
    return [data];
  }

  return [];
}

function normalizeCategory(value) {
  const category = cleanText(value).toLowerCase();

  const labels = {
    soccer: "Football",
    football: "Football",
    basketball: "Basketball",
    hockey: "Hockey",
    baseball: "Baseball",
    combat: "Combat Sports",
    racing: "Racing",
    tennis: "Tennis",
    cricket: "Cricket",
  };

  return labels[category] || cleanText(value, "Sports");
}

function parseSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);

    if (!validAllowedUrl(sourceUrl)) return null;

    const parts = url.pathname.split("/").filter(Boolean);

    if (
      parts.length < 3 ||
      parts[0].toLowerCase() !== "embed"
    ) {
      return null;
    }

    const category = parts[1];
    const sourceKey = parts.slice(2).join("/");

    // StreamFree's API names sources by appending a quality suffix
    // to the real stream key, e.g. skyf1 + 1080p.
    const match = sourceKey.match(
      /^(.*?)(2160p|1080p|720p2|720p|540p)$/i
    );

    const streamKey = match ? match[1] : sourceKey;
    const qualityFromSource = match ? match[2].toLowerCase() : null;

    return {
      origin: url.origin,
      category,
      streamKey,
      qualityFromSource,
      embedUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

function parseQualityTokens(html) {
  const tokens = {};

  const qualityRegex =
    /"(2160p|1080p|720p|540p)"\s*:\s*\{\s*"_e"\s*:\s*(\d+)\s*,\s*"_n"\s*:\s*"([^"]+)"\s*,\s*"_t"\s*:\s*"([^"]+)"/g;

  let match;

  while ((match = qualityRegex.exec(html))) {
    tokens[match[1]] = {
      e: match[2],
      n: match[3],
      t: match[4],
    };
  }

  return tokens;
}

async function resolveDirectHls(sourceUrl) {
  const parsed = parseSourceUrl(sourceUrl);

  if (!parsed) return null;

  try {
    // Fetch the actual StreamFree embed page. The page contains the
    // current signed _t/_e/_n values used to authorize its HLS playlist.
    const embedResponse = await fetch(parsed.embedUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; Sports-Corner/1.0; +https://fancode-corner.vercel.app/)",
        Referer: "https://streamfree.top/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!embedResponse.ok) return null;

    const html = await embedResponse.text();

    const tokens = parseQualityTokens(html);

    // Ask the same StreamFree endpoint used by its player to determine
    // whether this stream is external and which server hosts the HLS.
    const keyUrl =
      `${parsed.origin}/get-stream-key/` +
      encodeURIComponent(parsed.streamKey);

    let serverData = {};

    try {
      const keyResponse = await fetch(keyUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; Sports-Corner/1.0)",
          Referer: parsed.embedUrl,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (keyResponse.ok) {
        serverData = await keyResponse.json();
      }
    } catch {
      serverData = {};
    }

    if (
      serverData?.is_external === true &&
      validAllowedUrl(serverData?.external_url) &&
      isHlsUrl(serverData.external_url)
    ) {
      return serverData.external_url;
    }

    const availableQualities =
      Object.keys(tokens).length > 0
        ? tokens
        : {};

    const requestedQuality = parsed.qualityFromSource;

    const qualities = [
      requestedQuality,
      ...QUALITY_ORDER,
    ].filter(Boolean);

    const uniqueQualities = [...new Set(qualities)];

    const serverName = cleanText(
      serverData?.server_name,
      "origin"
    );

    for (const quality of uniqueQualities) {
      const token = availableQualities[quality];

      if (!token) continue;

      const suffix =
        quality === "2160p" ? "2160p" :
        quality === "1080p" ? "1080p" :
        quality === "720p" ? "720p" :
        "540p";

      const basePath =
        serverName !== "origin"
          ? `/live-cdn/${parsed.streamKey}${suffix}/index.m3u8`
          : `/live/${parsed.streamKey}${suffix}/index.m3u8`;

      const directUrl =
        `${parsed.origin}${basePath}` +
        `?_t=${encodeURIComponent(token.t)}` +
        `&_e=${encodeURIComponent(token.e)}` +
        `&_n=${encodeURIComponent(token.n)}`;

      if (!validAllowedUrl(directUrl) || !isHlsUrl(directUrl)) {
        continue;
      }

      // Validate the generated playlist before returning it. We do not
      // proxy media; this only confirms that the signed HLS URL is live.
      try {
        const playlistResponse = await fetch(directUrl, {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept:
              "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
            Referer: parsed.embedUrl,
            "User-Agent":
              "Mozilla/5.0 (compatible; Sports-Corner/1.0)",
          },
          signal: AbortSignal.timeout(7000),
        });

        if (playlistResponse.ok) {
          const playlist = await playlistResponse.text();

          if (
            playlist.includes("#EXTM3U") ||
            playlist.includes("#EXT-X-")
          ) {
            return directUrl;
          }
        }
      } catch {
        // Try the next available quality.
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function resolveSources(item) {
  const sources = Array.isArray(item?.sources)
    ? item.sources
        .map(cleanText)
        .filter(validAllowedUrl)
    : [];

  // Try every API-provided source, preferring the declared highest-quality
  // variants only after their exact URLs have been considered.
  const ordered = [...sources].sort((a, b) => {
    const score = (url) => {
      const lower = url.toLowerCase();

      if (/2160p(?:[/?#]|$)/.test(lower)) return 4;
      if (/1080p(?:[/?#]|$)/.test(lower)) return 3;
      if (/720p/.test(lower)) return 2;
      if (/540p/.test(lower)) return 1;

      return 0;
    };

    return score(b) - score(a);
  });

  for (const source of ordered) {
    const direct = await resolveDirectHls(source);

    if (direct) {
      return {
        embed_url: source,
        stream_url: direct,
      };
    }
  }

  return {
    embed_url: ordered[0] || cleanText(item?.embed_url),
    stream_url: null,
  };
}

async function fetchStreamFree() {
  const attempts = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const apiUrl =
        `${STREAMFREE_API}?_=${Date.now()}-${attempt}`;

      const response = await fetch(apiUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; Sports-Corner/1.0; +https://fancode-corner.vercel.app/)",
          Referer: "https://streamfree.top/",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        attempts.push(`attempt ${attempt}: HTTP ${response.status}`);

        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
          break;
        }

        continue;
      }

      return {
        data: await response.json(),
        attempts,
      };
    } catch (error) {
      attempts.push(
        `attempt ${attempt}: ${
          error?.name === "AbortError"
            ? "timeout"
            : "network error"
        }`
      );
    }
  }

  return {
    data: null,
    attempts,
  };
}

async function normalizeStream(item) {
  if (!item || typeof item !== "object") return null;

  const resolved = await resolveSources(item);

  if (!resolved.stream_url) {
    // Keep an event only when we still have a valid StreamFree embed URL.
    if (!validAllowedUrl(resolved.embed_url)) {
      return null;
    }
  }

  const title = cleanText(
    item?.name ||
      item?.title ||
      item?.event_name,
    "StreamFree Live Event"
  );

  const thumbnail = cleanText(
    item?.thumbnail_url ||
      item?.poster ||
      item?.image
  );

  const streamKey = cleanText(
    item?.stream_key ||
      item?.id ||
      resolved.embed_url
  );

  const rawCategory = cleanText(
    item?.category,
    "sports"
  ).toLowerCase();

  return {
    title,
    stream_url: resolved.stream_url,
    embed_url: resolved.embed_url || null,
    src_image: thumbnail || null,
    source: "streamfree",
    feed: "api",
    category: normalizeCategory(rawCategory),
    streamfree_category: rawCategory,
    league: cleanText(item?.league) || null,
    status: "LIVE",
    event_name: title,
    match_name: title,
    match_id: streamKey,
    start_time: item?.match_timestamp ?? null,
    playable: Boolean(resolved.stream_url),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
    });
  }

  if (!validAccessToken(req)) {
    res.setHeader("Cache-Control", "no-store");

    return res.status(403).json({
      status: "blocked",
      code: "STREAM_ACCESS_DENIED",
      message: "Access verification required.",
    });
  }

  const upstream = await fetchStreamFree();

  if (!upstream.data) {
    console.error(
      "StreamFree upstream failed:",
      upstream.attempts
    );

    return res.status(502).json({
      status: "error",
      code: "STREAMFREE_UPSTREAM_UNAVAILABLE",
      message:
        "StreamFree API is unavailable from the server right now.",
      attempts: upstream.attempts,
    });
  }

  const rawStreams = extractStreams(upstream.data);

  const matches = [];

  // Resolve the direct HLS URLs sequentially to avoid hammering the
  // upstream player endpoints.
  for (const item of rawStreams) {
    const normalized = await normalizeStream(item);

    if (normalized) {
      matches.push(normalized);
    }
  }

  const seen = new Set();
  const uniqueMatches = matches.filter((match) => {
    const key =
      match.match_id ||
      match.stream_url ||
      match.embed_url;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  uniqueMatches.sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=30, stale-while-revalidate=60"
  );
// Safe diagnostic logging — never log signed stream URLs.
console.info(
  "StreamFree frontend payload:",
  JSON.stringify({
    status: "success",
    count: uniqueMatches.length,
    playable_count: uniqueMatches.filter(
      (match) => match.playable
    ).length,
    matches: uniqueMatches.map((match) => ({
      title: match.title,
      category: match.category,
      source: match.source,
      match_id: match.match_id,
      has_stream_url: Boolean(match.stream_url),
      has_embed_url: Boolean(match.embed_url),
      playable: Boolean(match.playable)
    }))
  })
);
  return res.status(200).json({
    status: "success",
    sources: {
      streamfree: {
        available: true,
        error: null,
        event_count: uniqueMatches.length,
        playable_count: uniqueMatches.filter(
          (match) => match.playable
        ).length,
      },
    },
    count: uniqueMatches.length,
    matches: uniqueMatches,
  });
}
