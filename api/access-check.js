import crypto from "node:crypto";

const TOKEN_COOKIE = "sc_access";
const TOKEN_TTL_SECONDS = 30 * 60;
const IP_CACHE_TTL_MS = 5 * 60 * 1000;

const ipVerdictCache = globalThis.__sportsCornerIpCache || new Map();
globalThis.__sportsCornerIpCache = ipVerdictCache;

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

    if (part.slice(0, index).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return "";
    }
  }

  return "";
}

function isValidAccessToken(req) {
  const secret = String(process.env.ACCESS_SECRET || "");
  if (!secret) return false;

  const ip = getClientIp(req);
  const token = getCookie(req, TOKEN_COOKIE);
  if (!ip || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expires, ipHash, signature] = parts;
  const expiresNumber = Number(expires);

  if (!Number.isInteger(expiresNumber)) return false;
  if (expiresNumber <= Math.floor(Date.now() / 1000)) return false;

  const expectedIpHash = crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex");

  if (ipHash !== expectedIpHash) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${expires}.${ipHash}`)
    .digest("hex");

  if (signature.length !== expectedSignature.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

function signAccessToken(ip) {
  const secret = String(process.env.ACCESS_SECRET || "");
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${expires}.${ipHash}`)
    .digest("hex");

  return `${expires}.${ipHash}.${signature}`;
}

function setAccessCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Max-Age=${TOKEN_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function classifyIpData(data) {
  const isVpn = normalizeBoolean(data?.is_vpn);
  const isProxy = normalizeBoolean(data?.is_proxy);
  const isTor = normalizeBoolean(data?.is_tor);
  const isDatacenter = normalizeBoolean(data?.is_datacenter);
  const isEgressService = normalizeBoolean(data?.egress_service);

  if (isTor) {
    return { blocked: true, code: "TOR_DETECTED", reason: "Tor connection detected." };
  }
  if (isVpn) {
    return { blocked: true, code: "VPN_DETECTED", reason: "VPN connection detected." };
  }
  if (isProxy) {
    return { blocked: true, code: "PROXY_DETECTED", reason: "Proxy connection detected." };
  }
  if (isDatacenter) {
    return { blocked: true, code: "DATACENTER_DETECTED", reason: "Datacenter connection detected." };
  }
  if (isEgressService) {
    return { blocked: true, code: "PRIVACY_RELAY_DETECTED", reason: "Privacy relay or egress service detected." };
  }

  return {
    blocked: false,
    code: "NETWORK_CLEAN",
    reason: "No restricted network type was reported."
  };
}

async function verifyIp(ip) {
  const now = Date.now();
  const cached = ipVerdictCache.get(ip);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const key = String(process.env.IPAPI_KEY || "");
  if (!key) {
    return {
      available: false,
      blocked: false,
      code: "IP_PROVIDER_NOT_CONFIGURED",
      reason: "IP network verification is not configured."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const url = `https://api.ipapi.is/?q=${encodeURIComponent(ip)}&key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`IP verification HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = {
      available: true,
      ...classifyIpData(data)
    };

    ipVerdictCache.set(ip, {
      expiresAt: now + IP_CACHE_TTL_MS,
      value: result
    });

    return result;
  } catch (error) {
    return {
      available: false,
      blocked: false,
      code: "IP_PROVIDER_UNAVAILABLE",
      reason: "Network verification service could not be reached.",
      detail: error?.name === "AbortError" ? "IP verification timed out." : String(error?.message || "Unknown verification error")
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Cookie");

  const secret = String(process.env.ACCESS_SECRET || "");
  if (!secret) {
    return sendJson(res, 500, {
      allowed: false,
      code: "ACCESS_NOT_CONFIGURED",
      reason: "Access system is not configured.",
      message: "ACCESS_SECRET is missing on the server."
    });
  }

  const ip = getClientIp(req);
  if (!ip) {
    return sendJson(res, 403, {
      allowed: false,
      code: "IP_UNAVAILABLE",
      reason: "Client network address could not be determined.",
      message: "Access was blocked because the client IP could not be determined."
    });
  }

  // A valid short-lived token is enough to pass without re-running the
  // external IP classifier on every page/API request.
  if (isValidAccessToken(req)) {
    return sendJson(res, 200, {
      allowed: true,
      code: "ACCESS_GRANTED",
      reason: "Access verified.",
      token_ttl_seconds: TOKEN_TTL_SECONDS,
      checks: {
        network: "passed",
        access_token: "passed"
      }
    });
  }

  const ipResult = await verifyIp(ip);
  const strict = String(process.env.ACCESS_STRICT || "false").toLowerCase() === "true";

  if (!ipResult.available) {
    if (strict) {
      return sendJson(res, 503, {
        allowed: false,
        code: ipResult.code,
        reason: "Network verification could not be completed.",
        message: `${ipResult.reason} Access is blocked in strict mode.`,
        detail: ipResult.detail || null,
        checks: {
          network: "unknown",
          access_token: "blocked"
        }
      });
    }

    // Preserve the existing fail-open behavior when ACCESS_STRICT=false.
    const token = signAccessToken(ip);
    setAccessCookie(res, token);

    return sendJson(res, 200, {
      allowed: true,
      code: "ACCESS_GRANTED_UNVERIFIED",
      reason: "Access verified without external IP classification.",
      token_ttl_seconds: TOKEN_TTL_SECONDS,
      checks: {
        network: "unverified",
        access_token: "passed"
      }
    });
  }

  if (ipResult.blocked) {
    return sendJson(res, 403, {
      allowed: false,
      code: ipResult.code,
      reason: ipResult.reason,
      message: `Access blocked: ${ipResult.reason}`,
      checks: {
        network: "blocked",
        access_token: "blocked"
      }
    });
  }

  const token = signAccessToken(ip);
  setAccessCookie(res, token);

  return sendJson(res, 200, {
    allowed: true,
    code: "ACCESS_GRANTED",
    reason: "Access verified.",
    token_ttl_seconds: TOKEN_TTL_SECONDS,
    checks: {
      network: "passed",
      access_token: "passed"
    }
  });
}
