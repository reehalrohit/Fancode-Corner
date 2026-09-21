import crypto from "node:crypto";

const TOKEN_TTL = 30 * 60; // 30 minutes
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const cache =
  globalThis.__sportsCornerAccessCache ||
  (globalThis.__sportsCornerAccessCache = new Map());

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

    const key = part.slice(0, index).trim();

    if (key === name) {
      return decodeURIComponent(
        part.slice(index + 1).trim()
      );
    }
  }

  return "";
}

function hashIp(ip) {
  return crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex");
}

function sign(payload) {
  return crypto
    .createHmac(
      "sha256",
      String(process.env.ACCESS_SECRET || "")
    )
    .update(payload)
    .digest("hex");
}

function createToken(ip) {
  const expires =
    Math.floor(Date.now() / 1000) + TOKEN_TTL;

  const payload =
    `${expires}.${hashIp(ip)}`;

  return `${payload}.${sign(payload)}`;
}

function validateToken(token, ip) {
  if (!token) return false;

  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const [expires, ipHash, signature] = parts;

  if (
    !Number.isInteger(Number(expires)) ||
    Number(expires) <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  if (ipHash !== hashIp(ip)) {
    return false;
  }

  const payload =
    `${expires}.${ipHash}`;

  const expected =
    sign(payload);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

async function checkIp(ip) {
  const cached = cache.get(ip);

  if (
    cached &&
    Date.now() - cached.time < CACHE_TTL
  ) {
    return cached;
  }

  const apiKey =
    String(process.env.IPAPI_KEY || "");

  if (!apiKey) {
    return {
      blocked: false,
      reason: null,
      source: "not-configured",
      time: Date.now()
    };
  }

  try {
    const url =
      `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(3500)
    });

    if (!response.ok) {
      throw new Error(
        `IP API HTTP ${response.status}`
      );
    }

    const data = await response.json();

    let reason = null;

    if (data?.is_vpn) {
      reason = "VPN connection detected.";
    } else if (data?.is_proxy) {
      reason = "Proxy connection detected.";
    } else if (data?.is_tor) {
      reason = "Tor connection detected.";
    } else if (data?.is_datacenter) {
      reason = "Datacenter connection detected.";
    } else if (data?.egress_service) {
      reason = "Privacy relay detected.";
    }

    const result = {
      blocked: Boolean(reason),
      reason,
      source: "ipapi.is",
      time: Date.now()
    };

    cache.set(ip, result);

    return result;

  } catch (error) {
    console.error(
      "IP verification error:",
      error
    );

    const strict =
      String(
        process.env.ACCESS_STRICT || ""
      ).toLowerCase() === "true";

    return {
      blocked: strict,
      reason: strict
        ? "Network verification unavailable."
        : null,
      source: "provider-error",
      time: Date.now()
    };
  }
}

export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      allowed: false,
      reason: "Method not allowed."
    });
  }

  const secret =
    String(process.env.ACCESS_SECRET || "");

  if (!secret) {
    return res.status(503).json({
      allowed: false,
      reason:
        "Access system is not configured."
    });
  }

  const ip = getClientIp(req);

  if (!ip) {
    return res.status(403).json({
      allowed: false,
      reason:
        "Unable to identify connection."
    });
  }

  const existingToken =
    getCookie(req, "sc_access");

  if (
    validateToken(
      existingToken,
      ip
    )
  ) {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({
      allowed: true,
      reused: true
    });
  }

  const verdict =
    await checkIp(ip);

  if (verdict.blocked) {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(403).json({
      allowed: false,
      reason:
        verdict.reason ||
        "This connection is not allowed."
    });
  }

  const token =
    createToken(ip);

  res.setHeader(
    "Set-Cookie",
    [
      `sc_access=${encodeURIComponent(token)}`,
      `Max-Age=${TOKEN_TTL}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax"
    ].join("; ")
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  return res.status(200).json({
    allowed: true,
    reused: false
  });
}
