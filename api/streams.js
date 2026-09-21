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
      return decodeURIComponent(
        part.slice(index + 1).trim()
      );
    }
  }

  return "";
}

function validAccessToken(req) {
  const secret =
    String(process.env.ACCESS_SECRET || "");

  if (!secret) return false;

  const ip = getClientIp(req);
  const token =
    getCookie(req, "sc_access");

  if (!ip || !token) return false;

  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [
    expires,
    ipHash,
    signature
  ] = parts;

  if (
    !Number.isInteger(Number(expires)) ||
    Number(expires) <=
      Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expectedIpHash =
    crypto
      .createHash("sha256")
      .update(ip)
      .digest("hex");

  if (ipHash !== expectedIpHash) {
    return false;
  }

  const payload =
    `${expires}.${ipHash}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
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

export default async function handler(req, res) {
  if (!validAccessToken(req)) {
    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(403).json({
      status: "blocked",
      message:
        "Access verification required."
    });
  } 
  const sources = [
    {
      name: 'fancode',
      url: 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json',
    },
    {
      name: 'sonyliv',
      url: 'https://github.com/drmlive/sliv-live-events/raw/refs/heads/main/sonyliv.json',
    },
  ];

  // --------------------------------------------------
  // Recover complete objects from a truncated JSON array
  // without modifying/fabricating the upstream records.
  // --------------------------------------------------
  function recoverMatchesArray(text) {
    const matchesKey = text.indexOf('"matches"');

    if (matchesKey === -1) {
      return [];
    }

    const arrayStart = text.indexOf('[', matchesKey);

    if (arrayStart === -1) {
      return [];
    }

    const objects = [];

    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = arrayStart + 1; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          objectStart = i;
        }

        depth++;
        continue;
      }

      if (char === '}') {
        depth--;

        if (depth === 0 && objectStart !== -1) {
          const rawObject = text.slice(
            objectStart,
            i + 1
          );

          try {
            objects.push(JSON.parse(rawObject));
          } catch {
            // Ignore only this malformed object.
          }

          objectStart = -1;
        }
      }

      if (depth === 0 && char === ']') {
        break;
      }
    }

    return objects;
  }

  // --------------------------------------------------
  // Fetch source
  // --------------------------------------------------
  async function fetchSource(source) {
    try {
      const response = await fetch(
        `${source.url}?t=${Date.now()}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return {
          name: source.name,
          available: false,
          error: `HTTP ${response.status}`,
          data: null,
        };
      }

      const text = await response.text();

      // Normal JSON
      try {
        const data = JSON.parse(text);

        return {
          name: source.name,
          available: true,
          error: null,
          data,
        };
      } catch (error) {
        // SonyLIV currently has a truncated JSON file.
        // Recover only complete objects already present.
        if (source.name === 'sonyliv') {
          const recoveredMatches =
            recoverMatchesArray(text);

          if (recoveredMatches.length > 0) {
            return {
              name: source.name,
              available: true,
              error: 'Upstream JSON truncated; recovered complete records',
              data: {
                matches: recoveredMatches,
              },
            };
          }
        }

        return {
          name: source.name,
          available: false,
          error: 'Invalid JSON from upstream source',
          data: null,
        };
      }
    } catch (error) {
      console.error(
        `${source.name} fetch error:`,
        error
      );

      return {
        name: source.name,
        available: false,
        error: 'Network error',
        data: null,
      };
    }
  }

  try {
    const results = await Promise.all(
      sources.map(fetchSource)
    );

    const matches = [];

    // --------------------------------------------------
    // PROCESS SOURCES
    // --------------------------------------------------
    for (const result of results) {
      if (!result?.data) continue;

      const items = Array.isArray(
        result.data.matches
      )
        ? result.data.matches
        : [];

      // ==================================================
      // FANCODE
      // ==================================================
      if (result.name === 'fancode') {
        for (const item of items) {
          const isLive =
            String(item.status || '')
              .toUpperCase() === 'LIVE';

          if (!isLive) continue;

          const streamUrl =
            item.stream_url ||
            item.video_url ||
            item.dai_url ||
            item.adfree_url ||
            item.streams?.primary ||
            item.auto_streams?.ENGLISH?.streams?.['1080p'] ||
            item.auto_streams?.ENGLISH?.streams?.['720p'] ||
            item.auto_streams?.ENGLISH?.streams?.['540p'] ||
            item.auto_streams?.ENGLISH?.streams?.['480p'] ||
            item.auto_streams?.ENGLISH?.streams?.['360p'] ||
            item.auto_streams?.ENGLISH?.streams?.['240p'] ||
            '';

          matches.push({
            title: String(
              item.title ||
              item.match_name ||
              item.event_name ||
              'FanCode Live Event'
            ).trim(),

            stream_url:
              typeof streamUrl === 'string' &&
              streamUrl.includes('.m3u8')
                ? streamUrl
                : null,

            src_image:
              typeof item.src === 'string'
                ? item.src
                : null,

            source: 'fancode',

            category:
              item.event_category ||
              null,

            status:
              item.status ||
              null,

            event_name:
              item.event_name ||
              null,

            match_name:
              item.match_name ||
              null,

            match_id:
              item.match_id ||
              null,

            start_time:
              item.startTime ||
              null,
          });
        }
      }

      // ==================================================
      // SONYLIV
      // ==================================================
      if (result.name === 'sonyliv') {
        const grouped = new Map();

        for (const item of items) {
          if (item.isLive !== true) continue;

          const streamUrl =
            item.dai_url ||
            item.pub_url ||
            item.video_url ||
            '';

          if (
            typeof streamUrl !== 'string' ||
            !streamUrl.includes('.m3u8')
          ) {
            continue;
          }

          const rawId = String(
            item.contentId || ''
          );

          const baseId =
            rawId.includes('_')
              ? rawId.split('_')[0]
              : rawId;

          const groupKey =
            baseId ||
            item.match_name ||
            item.event_name ||
            streamUrl;

          const candidate = {
            title: String(
              item.match_name ||
              item.event_name ||
              'SonyLIV Live Event'
            ).trim(),

            stream_url: streamUrl,

            src_image:
              typeof item.src === 'string'
                ? item.src
                : null,

            source: 'sonyliv',

            category:
              item.event_category ||
              'Sports',

            status: 'LIVE',

            event_name:
              item.event_name ||
              null,

            match_name:
              item.match_name ||
              null,

            content_id:
              rawId ||
              null,

            broadcast_channel:
              item.broadcast_channel ||
              null,

            language:
              item.audioLanguageName ||
              null,
          };

          const existing =
            grouped.get(groupKey);

          if (!existing) {
            grouped.set(
              groupKey,
              candidate
            );

            continue;
          }

          const candidateIsEnglish =
            /_ENG$/i.test(rawId) ||
            String(
              item.audioLanguageName || ''
            )
              .toUpperCase()
              .startsWith('ENG');

          const existingIsEnglish =
            /_ENG$/i.test(
              String(
                existing.content_id || ''
              )
            );

          if (
            candidateIsEnglish &&
            !existingIsEnglish
          ) {
            grouped.set(
              groupKey,
              candidate
            );
          }
        }

        matches.push(
          ...grouped.values()
        );
      }
    }

    // --------------------------------------------------
    // Remove duplicates
    // --------------------------------------------------
    const seen = new Set();
    const uniqueMatches = [];

    for (const match of matches) {
      const key =
        match.source === 'sonyliv'
          ? `sonyliv|${
              match.content_id ||
              match.title
            }`
          : `fancode|${
              match.match_id ||
              match.title
            }`;

      if (seen.has(key)) continue;

      seen.add(key);
      uniqueMatches.push(match);
    }

    // --------------------------------------------------
    // Live events first
    // --------------------------------------------------
    uniqueMatches.sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === 'fancode'
          ? -1
          : 1;
      }

      return a.title.localeCompare(
        b.title
      );
    });

    // --------------------------------------------------
    // Cache
    // --------------------------------------------------
    res.setHeader(
      'Cache-Control',
      's-maxage=30, stale-while-revalidate=60'
    );

    // --------------------------------------------------
    // Response
    // --------------------------------------------------
    res.status(200).json({
      status: 'success',

      sources: {
        fancode: {
          available:
            results.find(
              r => r?.name === 'fancode'
            )?.available || false,

          error:
            results.find(
              r => r?.name === 'fancode'
            )?.error || null,
        },

        sonyliv: {
          available:
            results.find(
              r => r?.name === 'sonyliv'
            )?.available || false,

          error:
            results.find(
              r => r?.name === 'sonyliv'
            )?.error || null,
        },
      },

      count:
        uniqueMatches.length,

      matches:
        uniqueMatches,
    });

  } catch (error) {
    console.error(
      'Streams API error:',
      error
    );

    res.status(500).json({
      status: 'error',
      message:
        'Unable to load stream data',
    });
  }
            }
