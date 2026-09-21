export default async function handler(req, res) {
  const sources = [
    {
      url: 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json',
      name: 'fancode',
    },
    {
      url: 'https://github.com/drmlive/sliv-live-events/raw/refs/heads/main/sonyliv.json',
      name: 'sonyliv',
    },
  ];

  try {
    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          const response = await fetch(`${source.url}?t=${Date.now()}`);

          if (!response.ok) return null;

          return {
            name: source.name,
            data: await response.json(),
          };
        } catch {
          return null;
        }
      })
    );

    const matches = [];

    for (const result of results) {
      if (!result) continue;

      const items = Array.isArray(result.data?.matches)
        ? result.data.matches
        : [];

      if (result.name === 'fancode') {
        for (const item of items) {
          const streamUrl =
            item.dai_url ||
            item.adfree_url ||
            item.stream_url ||
            item.video_url;

          if (!streamUrl || typeof streamUrl !== 'string') continue;
          if (!streamUrl.includes('.m3u8')) continue;

          const title =
            item.match_name ||
            item.title ||
            item.event_name ||
            'Live Event';

          matches.push({
            title: String(title).trim(),
            stream_url: streamUrl,
            src_image:
              typeof item.src === 'string' ? item.src : null,
            source: 'fancode',
            category: item.event_category || null,
            status: item.status || null,
            event_name: item.event_name || null,
            match_name: item.match_name || null,
            match_id: item.match_id || null,
          });
        }
      }

      if (result.name === 'sonyliv') {
        const grouped = new Map();

        for (const item of items) {
          const streamUrl =
            item.dai_url ||
            item.pub_url ||
            item.video_url;

          if (!streamUrl || typeof streamUrl !== 'string') continue;
          if (!streamUrl.includes('.m3u8')) continue;

          /*
           * SonyLIV uses contentId values such as:
           * 1090543296_ENG
           * 1090543296_HIN
           *
           * Remove the language suffix so the same match
           * becomes one card.
           */
          const rawId = String(item.contentId || '');

          const baseId = rawId.includes('_')
            ? rawId.split('_')[0]
            : rawId;

          const groupKey =
            baseId ||
            item.match_name ||
            item.event_name ||
            streamUrl;

          const existing = grouped.get(groupKey);

          const title =
            item.match_name ||
            item.title ||
            item.event_name ||
            'Live Event';

          const candidate = {
            title: String(title).trim(),
            stream_url: streamUrl,
            src_image:
              typeof item.src === 'string' ? item.src : null,
            source: 'sonyliv',
            category: item.event_category || null,
            status: item.isLive ? 'LIVE' : null,
            event_name: item.event_name || null,
            match_name: item.match_name || null,
            content_id: rawId || null,
            language: item.audioLanguageName || null,
            broadcast_channel: item.broadcast_channel || null,
          };

          /*
           * Keep the first stream for an event.
           * Prefer ENG when available.
           */
          if (!existing) {
            grouped.set(groupKey, candidate);
          } else if (
            candidate.content_id?.endsWith('_ENG') &&
            !existing.content_id?.endsWith('_ENG')
          ) {
            grouped.set(groupKey, candidate);
          }
        }

        matches.push(...grouped.values());
      }
    }

    /*
     * Final safety deduplication.
     */
    const seen = new Set();
    const uniqueMatches = [];

    for (const match of matches) {
      const key =
        `${match.source}|${match.stream_url}`;

      if (seen.has(key)) continue;

      seen.add(key);
      uniqueMatches.push(match);
    }

    res.setHeader(
      'Cache-Control',
      's-maxage=60, stale-while-revalidate=120'
    );

    res.status(200).json({
      status: 'success',
      matches: uniqueMatches,
    });
  } catch (error) {
    console.error('streams API error:', error);

    res.status(500).json({
      status: 'error',
      message: 'Unable to load stream data',
    });
  }
}
