export default async function handler(req, res) {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('fancode_session=authenticated_secure_token')) {
        return res.status(403).json({ status: 'error', message: 'Unauthorized session' });
    }

    try {
        const response = await fetch('https://raw.githubusercontent.com/byte-capsule/FanCode-Live/main/fancode.json');
        if (!response.ok) throw new Error('Failed to fetch upstream stream data');
        
        const data = await response.json();
        return res.status(200).json({
            status: 'success',
            matches: data.matches || data
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to load live matches' });
    }
}
