export default async function handler(req, res) {
    const { source = 'kajju' } = req.query;

    let url = '';
    if (source === 'kajju') {
        url = 'https://raw.githubusercontent.com/kajju027/Fancode-Events-Json/main/fancode.json';
    } else if (source === 'drmlive') {
        url = 'https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json';
    } else {
        url = 'https://raw.githubusercontent.com/byte-capsule/FanCode-Hls-Fetcher/main/Fancode_hls_m3u8.Json';
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch upstream feed');
        
        const data = await response.json();
        return res.status(200).json({
            status: 'success',
            data: data
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to load streams from backend' });
    }
}
