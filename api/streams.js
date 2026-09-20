export default async function handler(req, res) {
    const sources = [
        { url: 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json', name: 'fancode' },
        { url: 'https://raw.githubusercontent.com/drmlive/sliv-live-events/main/sonyliv.json', name: 'sonyliv' }
    ];
    let allMatches = [];

    try {
        const responses = await Promise.all(
            sources.map(s => fetch(s.url + "?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null))
        );

        const extract = (obj, sourceName, parentKey = 'Live Event') => {
            if (!obj) return;
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => extract(item, sourceName, `Match ${index + 1}`));
                return;
            }
            if (typeof obj === 'object') {
                const url = obj.adfree_url || obj.stream_url || obj.stream_link || obj.url || obj.link || obj.m3u8 || obj.file || obj.stream || obj.daiUrl;
                const title = obj.title || obj.event_name || obj.name || obj.match_name || parentKey;
                const img = obj.image || obj.poster || obj.thumbnail || obj.banner || obj.logo || obj.src_image || null;
                
                if (url && typeof url === 'string' && (url.includes('.m3u8') || url.startsWith('http'))) {
                    allMatches.push({ title, stream_url: url, src_image: img, source: sourceName });
                } else {
                    for (const [key, value] of Object.entries(obj)) {
                        if (typeof value === 'string' && (value.includes('.m3u8') || value.startsWith('http'))) {
                            if (['adfree_url', 'stream_url', 'stream_link', 'url', 'link', 'm3u8', 'file', 'stream', 'daiUrl'].includes(key)) {
                                allMatches.push({ title: parentKey, stream_url: value, src_image: img, source: sourceName });
                            } 
                            else if (!['generated_by', 'banner', 'team_1_flag', 'team_2_flag', 'dai_url', 'ad_url'].includes(key)) {
                                allMatches.push({ title: key, stream_url: value, src_image: img, source: sourceName });
                            }
                        } else if (typeof value === 'object') {
                            extract(value, sourceName, isNaN(key) ? key : parentKey);
                        }
                    }
                }
            }
        };

        if (responses[0]) extract(responses[0], 'fancode');
        if (responses[1]) extract(responses[1], 'sonyliv');

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
