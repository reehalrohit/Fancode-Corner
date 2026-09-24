function validAppClient(req) {
  const configuredToken = String(
    process.env.APP_UA_TOKEN || 'K/4D8P7X2N9LQ'
  );

  const userAgent = String(
    req.headers['user-agent'] || ''
  );

  return Boolean(configuredToken) && userAgent.includes(configuredToken);
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'User-Agent');

  if (req.method !== 'GET') {
    return res.status(405).json({
      allowed: false,
      message: 'Method not allowed.'
    });
  }

  if (!validAppClient(req)) {
    return res.status(403).json({
      allowed: false,
      code: 'APP_REQUIRED',
      message: 'Sports Corner is available only through the Android app.'
    });
  }

  return res.status(200).json({
    allowed: true,
    client: 'sports-corner-android'
  });
}
