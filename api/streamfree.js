import crypto from "node:crypto";

const ACCESS_COOKIE = "sc_access";
const STREAMFREE_API = "https://streamfree.top/api/v1/streams";

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

  const expectedIpHash = crypto.createHash("sha256").update(ip).digest("hex");
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

function validEmbedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();

    // StreamFree may change the exact embed path while keeping the
    // embed on its own HTTPS origin. Do not silently discard valid items
    // just because the pathname is not exactly /embed/....
    return (
      url.protocol === "https:" &&
      (hostname === "streamfree.top" || hostname === "www.streamfree.top")
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

  // Support direct single-stream responses too.
  if (
    data &&
    typeof data === "object" &&
    (data.embed_url || data.stream_key || data.id)
  ) {
    return [data];
  }

  return [];
}

function normalizeCategory(value) {
  const category = cleanText(value).toLowerCase();

  const labels = {
    soccer: "Football",
    football: "American Football",
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

function normalizeStream(item) {
  const embedUrl = cleanText(item?.embed_url);
  if (!validEmbedUrl(embedUrl)) return null;

  const title = cleanText(
    item?.name || item?.title || item?.event_name,
    "StreamFree Live Event"
  );

  const thumbnail = cleanText(
    item?.thumbnail_url || item?.poster || item?.image
  );

  const streamKey = cleanText(item?.stream_key || item?.id || embedUrl);

  return {
    title,
    stream_url: null,
    embed_url: embedUrl,
    src_image: thumbnail || null,
    source: "streamfree",
    feed: "api",
    category: normalizeCategory(item?.category),
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
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

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
    const response = await fetch(STREAMFREE_API, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Sports-Corner/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(502).json({
        status: "error",
        code: "STREAMFREE_UPSTREAM_HTTP",
        message: `StreamFree returned HTTP ${response.status}.`,
      });
    }

    const data = await response.json();
    const rawStreams = extractStreams(data);
    const seen = new Set();
    const matches = [];

    for (const item of rawStreams) {
      const normalized = normalizeStream(item);
      if (!normalized) continue;

      const key = normalized.match_id || normalized.embed_url;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(normalized);
    }

    matches.sort((a, b) => a.title.localeCompare(b.title));

    return res.status(200).json({
      status: "success",
      sources: {
        streamfree: {
          available: true,
          error: null,
        },
      },
      count: matches.length,
      matches,
    });
  } catch (error) {
    console.error("StreamFree API error:", error);
    return res.status(502).json({
      status: "error",
      code: "STREAMFREE_UPSTREAM_UNAVAILABLE",
      message: "StreamFree source is currently unavailable.",
    });
  }
}
