import crypto from "node:crypto";

const ACCESS_COOKIE = "sc_access";

// Try the primary API first, then StreamFree's published mirror domains.
// This avoids losing all events if the primary origin returns a 5xx to Vercel.
const STREAMFREE_APIS = [
  "https://streamfree.top/api/v1/streams",
  "https://strmfree.st/api/v1/streams",
  "https://strmfree.link/api/v1/streams",
];

const STREAMFREE_HOSTS = new Set([
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
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      STREAMFREE_HOSTS.has(hostname)
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

function getEmbedUrl(item) {
  const direct = cleanText(item?.embed_url);

  if (validStreamFreeUrl(direct)) {
    return direct;
  }

  const sources = Array.isArray(item?.sources)
    ? item.sources
    : [];

  // Prefer an actual live source supplied by StreamFree.
  // The API examples currently return strmfree.st embed URLs.
  for (const source of sources) {
    if (validStreamFreeUrl(source)) {
      return String(source).trim();
    }
  }

  // Fallback only when sources[] is absent.
  const category = cleanText(item?.category).toLowerCase();
  const streamKey = cleanText(item?.stream_key);

  if (category && streamKey) {
    return (
      "https://streamfree.top/embed/" +
      encodeURIComponent(category) +
      "/" +
      encodeURIComponent(streamKey)
    );
  }

  return "";
}

async function fetchStreamFree() {
  const attempts = [];

  for (const apiUrl of STREAMFREE_APIS) {
    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; Sports-Corner/1.0; +https://fancode-corner.vercel.app/)",
          Referer: "https://streamfree.top/",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        attempts.push(`${apiUrl}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      return {
        apiUrl,
        data,
        attempts,
      };
    } catch (error) {
      attempts.push(
        `${apiUrl}: ${error?.name === "AbortError" ? "timeout" : "network error"}`
      );
    }
  }

  return {
    apiUrl: null,
    data: null,
    attempts,
  };
}

function normalizeStream(item) {
  if (!item || typeof item !== "object") return null;

  const embedUrl = getEmbedUrl(item);

  if (!validStreamFreeUrl(embedUrl)) {
    return null;
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
      embedUrl
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

  try {
    const upstream = await fetchStreamFree();

    if (!upstream.data) {
      console.error(
        "StreamFree all endpoints failed:",
        upstream.attempts
      );

      return res.status(502).json({
        status: "error",
        code: "STREAMFREE_ALL_UPSTREAMS_FAILED",
        message:
          "StreamFree API is unavailable from the server right now.",
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
          upstream: upstream.apiUrl,
          upstream_attempts: upstream.attempts,
        },
      },
      count: matches.length,
      matches,
    });
  } catch (error) {
    console.error("StreamFree adapter error:", error);

    return res.status(502).json({
      status: "error",
      code: "STREAMFREE_ADAPTER_FAILED",
      message: "StreamFree source could not be loaded.",
    });
  }
}
