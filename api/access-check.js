import crypto from "node:crypto";

const TOKEN_COOKIE = "sc_access";
const TOKEN_TTL_SECONDS = 30 * 60;

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

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

function buildToken(ip, secret, expires) {
  const ipHash = crypto
    .createHash("sha256")
    .update(ip)
    .digest("hex");

  const payload = `${expires}.${ipHash}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return `${expires}.${ipHash}.${signature}`;
}

function validAccessToken(token, ip, secret) {
  if (!token || !ip || !secret) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

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

  if (!safeEqual(ipHash, expectedIpHash)) {
    return false;
  }

  const payload = `${expires}.${ipHash}`;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return safeEqual(signature, expectedSignature);
}

function setAccessCookie(res, token, maxAge) {
  res.setHeader(
    "Set-Cookie",
    `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

async function checkIpProvider(ip, apiKey) {
  const url =
    `https://api.ipapi.is/?q=${encodeURIComponent(ip)}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();

    let data = {};

    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        code: "IP_PROVIDER_INVALID_RESPONSE",
        reason: "The IP verification service returned an invalid response.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: "IP_PROVIDER_HTTP_ERROR",
        reason:
          `The IP verification service returned HTTP ${response.status}.`,
        providerStatus: response.status,
      };
    }

    return {
      ok: true,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      code:
        error?.name === "AbortError"
          ? "IP_PROVIDER_TIMEOUT"
          : "IP_PROVIDER_UNREACHABLE",
      reason:
        error?.name === "AbortError"
          ? "The IP verification service timed out."
          : "The IP verification service could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyIp(data) {
  const checks = [
    {
      flag: "is_vpn",
      code: "VPN_DETECTED",
      message: "VPN connection detected. Disable your VPN and try again.",
    },
    {
      flag: "is_proxy",
      code: "PROXY_DETECTED",
      message: "Proxy connection detected. Disable your proxy and try again.",
    },
    {
      flag: "is_tor",
      code: "TOR_DETECTED",
      message: "Tor connection detected. Tor connections are not allowed.",
    },
    {
      flag: "is_datacenter",
      code: "DATACENTER_DETECTED",
      message: "Datacenter IP detected. Use a normal residential or mobile connection.",
    },
    {
      flag: "egress_service",
      code: "EGRESS_SERVICE_DETECTED",
      message: "A privacy/egress service was detected. Disable it and try again.",
    },
  ];

  for (const check of checks) {
    if (data?.[check.flag] === true) {
      return {
        blocked: true,
        code: check.code,
        reason: check.message,
      };
    }
  }

  return {
    blocked: false,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "User-Agent");

  if (req.method !== "GET") {
    return res.status(405).json({
      allowed: false,
      code: "METHOD_NOT_ALLOWED",
      reason: "Only GET requests are allowed for access verification.",
      message: "Method not allowed.",
    });
  }

  const secret = String(process.env.ACCESS_SECRET || "");

  if (!secret) {
    return res.status(500).json({
      allowed: false,
      code: "ACCESS_NOT_CONFIGURED",
      reason: "Server access configuration is incomplete: ACCESS_SECRET is missing.",
      message: "Server access system is not configured.",
    });
  }

  const ip = getClientIp(req);

  if (!ip) {
    return res.status(400).json({
      allowed: false,
      code: "IP_DETECTION_FAILED",
      reason: "The server could not determine the client IP address.",
      message: "Unable to determine client network.",
    });
  }

  const existingToken = getCookie(req, TOKEN_COOKIE);

  if (validAccessToken(existingToken, ip, secret)) {
    return res.status(200).json({
      allowed: true,
      code: "ACCESS_OK",
      reason: "Existing access token is valid.",
    });
  }

  const apiKey = String(process.env.IPAPI_KEY || "").trim();
  const strict = String(process.env.ACCESS_STRICT || "false")
    .toLowerCase() === "true";

  // IP classification is optional. Without a key, access verification
  // still works, but VPN/proxy/Tor/datacenter classification is skipped.
  if (apiKey) {
    const provider = await checkIpProvider(ip, apiKey);

    if (!provider.ok) {
      if (strict) {
        return res.status(503).json({
          allowed: false,
          code: provider.code || "IP_PROVIDER_UNAVAILABLE",
          reason:
            `${provider.reason || "The IP verification service is unavailable."} ` +
            "ACCESS_STRICT=true is blocking access until verification succeeds.",
          message: "Network verification unavailable.",
        });
      }
    } else {
      const classification = classifyIp(provider.data);

      if (classification.blocked) {
        return res.status(403).json({
          allowed: false,
          code: classification.code,
          reason: classification.reason,
          message: classification.reason,
        });
      }
    }
  }

  const expires =
    Math.floor(Date.now() / 1000) +
    TOKEN_TTL_SECONDS;

  const token = buildToken(ip, secret, expires);

  setAccessCookie(res, token, TOKEN_TTL_SECONDS);

  return res.status(200).json({
    allowed: true,
    code: "ACCESS_GRANTED",
    reason: apiKey
      ? "Access verification passed."
      : "Access granted. IP classification is disabled because IPAPI_KEY is not configured.",
    ip_verification:
      apiKey ? "enabled" : "skipped",
    token_expires_in: TOKEN_TTL_SECONDS,
  });
}
