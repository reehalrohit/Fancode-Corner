export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { passcode } = req.body || {};
    const DAILY_PASSCODE = process.env.DAILY_PASSCODE || "MODZONE2026";

    if (passcode === DAILY_PASSCODE) {
        res.setHeader(
            'Set-Cookie', 
            'fancode_session=authenticated_secure_token; HttpOnly; Secure; Path=/; Max-Age=86400; SameSite=Strict'
        );
        return res.status(200).json({ status: 'success' });
    } else {
        return res.status(401).json({ status: 'error', message: 'Invalid passcode' });
    }
}
