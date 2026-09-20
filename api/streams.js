export default async function handler(req, res) {
    const sources = [
        { url: 'https://raw.githubusercontent.com/byte-capsule/FanCode-Hls-Fetcher/main/Fancode_hls_m3u8.Json', name: 'byte-capsule' },
        { url: 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json', name: 'drmlive' }
    ];
    let allMatches = [];

    try {
        const responses = await Promise.all(
            sources.map(s => fetch(s.url + "?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null))
        );

        const extract = (obj, sourceName) => {
            if (!obj) return;
            if (Array.isArray(obj)) {
                obj.forEach(item => extract(item, sourceName));
            } else if (typeof obj === 'object') {
                const url = obj.stream_url || obj.url || obj.link || obj.m3u8 || obj.file;
                const title = obj.title || obj.event_name || obj.name || obj.match_name || 'Live Event';
                const img = obj.image || obj.poster || obj.thumbnail || null;
                
                // ONLY accept valid video streams (.m3u8)
                if (url && typeof url === 'string' && url.includes('.m3u8')) {
                    allMatches.push({ title, stream_url: url, src_image: img, source: sourceName });
                } else {
                    for (const [key, value] of Object.entries(obj)) {
                        // Strict check to exclude image banners and flags
                        if (typeof value === 'string' && value.includes('.m3u8')) {
                            if (!['generated_by', 'banner', 'team_1_flag', 'team_2_flag'].includes(key)) {
                                allMatches.push({ title: key, stream_url: value, source: sourceName });
                            }
                        } else if (typeof value === 'object') {
                            extract(value, sourceName);
                        }
                    }
                }
            }
        };

        if (responses[0]) extract(responses[0], 'byte-capsule');
        if (responses[1]) extract(responses[1], 'drmlive');

        const uniqueMatches = [];
        const seenUrls = new Set();
        for (const match of allMatches) {
            if (!seenUrls.has(match.stream_url)) {
                seenUrls.add(match.stream_url);
                uniqueMatches.push(match);
            }
        }

        res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate');
        res.status(200).json({ status: 'success', matches: uniqueMatches });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
}
