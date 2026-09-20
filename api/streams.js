export default async function handler(req, res) {
    const { source = 'drmlive' } = req.query;

    let url = '';
    if (source === 'drmlive') {
        url = 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json';
    } else {
        url = 'https://raw.githubusercontent.com/byte-capsule/FanCode-Hls-Fetcher/main/Fancode_hls_m3u8.Json';
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch upstream feed');
        
        const data = await response.json();
        
        let rawMatches = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
        
        const normalizedMatches = rawMatches.map(match => {
            const streamUrl = match.stream_link || match.url || match.stream_url || match.link || match.daiUrl || match.adfree_url || '';
            const title = match.title || match.match_name || 'Live Event';
            const image = match.src_image || match.image || match.banner || '';
            
            return {
                ...match,
                title,
                stream_url: streamUrl,
                src_image: image
            };
        }).filter(match => match.stream_url !== '');

        return res.status(200).json({
            status: 'success',
            matches: normalizedMatches
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to load streams from backend' });
    }
}
