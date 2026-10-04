import crypto from "node:crypto";

const ACCESS_COOKIE = "sc_access";
const STREAMFREE_API = "https://streamfree.top/api/v1/streams";
const STREAMFREE_ORIGINS = new Set([
  "streamfree.top",
  "www.streamfree.top",
  "strmfree.st",
  "www.strmfree.st",
  "strmfree.link",
  "www.strmfree.link",
]);

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

function validStreamFreeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      STREAMFREE_ORIGINS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
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

/*
 * StreamFree documents that /api/v1/streams returns a `sources` array
 * containing the live embed variants. Use those exact URLs.
 *
 * Do NOT manufacture streamfree.top/embed/... when sources[] exists,
 * because the live source may intentionally be served from a mirror such
 * as strmfree.st.
 */
function chooseSource(item) {
  const sources = Array.isArray(item?.sources)
    ? item.sources
        .map((value) => cleanText(value))
        .filter(validStreamFreeUrl)
    : [];

  if (sources.length > 0) {
    const score = (url) => {
      const lower = url.toLowerCase();

      if (/1080p2?(?:[/?#]|$)/.test(lower)) return 5;
      if (/1080p(?:[/?#]|$)/.test(lower)) return 4;
      if (/720p2?(?:[/?#]|$)/.test(lower)) return 3;
      if (/720p(?:[/?#]|$)/.test(lower)) return 2;
      if (/540p|480p|360p/.test(lower)) return 1;

      return 0;
    };

    return [...sources].sort((a, b) => score(b) - score(a))[0];
  }

  const direct = cleanText(item?.embed_url);

  if (validStreamFreeUrl(direct)) {
    return direct;
  }

  return "";
}

function normalizeStream(item) {
  if (!item || typeof item !== "object") return null;

  const embedUrl = chooseSource(item);

  // Every displayed StreamFree event must have an actual returned source.
  if (!embedUrl) return null;

  const title = cleanText(
    item?.name || item?.title || item?.event_name,
    "StreamFree Live Event"
  );

  const thumbnail = cleanText(
    item?.thumbnail_url || item?.poster || item?.image
  );

  const streamKey = cleanText(
    item?.stream_key || item?.id || embedUrl
  );

  const rawCategory = cleanText(
    item?.category,
    "sports"
  ).toLowerCase();

  return {
    title,
    stream_url: null,
    embed_url: embedUrl,
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
    playable: false,
  };
}

async function requestStreamFree(attempt) {
  const separator = STREAMFREE_API.includes("?") ? "&" : "?";
  const url = `${STREAMFREE_API}${separator}_=${Date.now()}-${attempt}`;

  return fetch(url, {
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
}

async function fetchStreamFree() {
  const attempts = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await requestStreamFree(attempt);

      if (!response.ok) {
        attempts.push(`attempt ${attempt}: HTTP ${response.status}`);

        // Retry transient upstream/server failures.
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
          break;
        }

        continue;
      }

      const data = await response.json();

      return {
        data,
        attempts,
      };
    } catch (error) {
      attempts.push(
        `attempt ${attempt}: ${
          error?.name === "AbortError" ? "timeout" : "network error"
        }`
      );
    }
  }

  return {
    data: null,
    attempts,
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
      message: "StreamFree API is unavailable from the server right now.",
      attempts: upstream.attempts,
    });
  }

  const rawStreams = extractStreams(upstream.data);

  const seen = new Set();
  const matches = [];

  for (const item of rawStreams) {
    const normalized = normalizeStream(item);

    if (!normalized) continue;

    const key =
      normalized.match_id ||
      normalized.embed_url;

    if (seen.has(key)) continue;

    seen.add(key);
    matches.push(normalized);
  }

  matches.sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=30, stale-while-revalidate=60"
  );

  return res.status(200).json({
    status: "success",
    sources: {
      streamfree: {
        available: true,
        error: null,
        event_count: matches.length,
      },
    },
    count: matches.length,
    matches,
  });
}
