# 🏟️ Sports Corner

A lightweight, mobile-first live sports aggregation website that presents currently live events from FanCode and SonyLIV in a single interface.

**Live site:** https://fancode-corner.vercel.app/  
**Repository:** https://github.com/reehalrohit/Fancode-Corner

## ✨ Features

- 🏏 FanCode live-event section
- 📺 SonyLIV live-event section
- 🔴 Live-only event filtering
- 🔎 Category filters:
  - All Live
  - Cricket
  - Football
  - Racing
  - Other
- 🔄 Manual refresh of live events
- 📱 Responsive/mobile-optimized interface
- ▶️ Android stream handoff through an external player intent
- 📋 Copy stream URL to clipboard
- 🖼️ Event artwork with fallback image
- ⚖️ Mandatory Legal Notice & User Agreement
- 🔐 Daily passcode access gate
- 🔐 Server-side access verification
- 🛡️ VPN/proxy/Tor/datacenter/privacy-relay detection when configured
- 🍪 Short-lived, IP-bound signed access cookie
- 🚫 Client-side ad-block/DNS filtering detection
- 💰 HilltopAds integration
- 📊 Vercel Web Analytics
- ⚡ Vercel serverless API architecture

## 🔐 Access Gates

Fancode-Corner uses **two separate access gates**, and both are required.

### 1. Legal Notice & User Agreement

Before reaching the passcode screen, visitors must review the Legal Notice and explicitly select **I Agree & Continue**.

The legal agreement explains that:

- Fancode-Corner is an aggregation/interface layer.
- It does not claim ownership of third-party streams or other third-party material.
- Third-party resources may be operated by independent services.
- Users are responsible for determining whether their use complies with applicable laws, licences, rights, and platform terms.
- Fancode-Corner does not grant rights or licences to third-party content.
- The project does not authorize circumvention of DRM, authentication, paywalls, geographic restrictions, or other access controls.

Legal acceptance is stored locally using a versioned browser storage key. When the legal-notice version changes, users must accept the updated notice again.

The complete disclaimer is available in:

`DISCLAIMER.md`

### 2. Daily Passcode

After accepting the legal notice, the existing daily passcode gate remains active.

The legal agreement **does not replace or bypass the daily passcode**, and the daily passcode **does not replace or bypass the legal agreement**.

The access sequence is:

```text
Legal Notice
     │
     ▼
I Agree & Continue
     │
     ▼
App / Client Verification
     │
     ▼
Daily Passcode
     │
     ▼
Access Verification
     │
     ▼
Sports Corner
```

## ⚠️ Important Legal Notice

Fancode-Corner is an aggregation/interface project. It does not host, upload, store, produce, own, or claim ownership of third-party video streams or other content referenced through the website.

The availability of a stream or URL on a publicly accessible third-party service does not mean that Fancode-Corner represents the content as licensed or authorized in every jurisdiction.

Users are solely responsible for their own use of third-party links, streams, websites, and content.

Users must determine whether accessing, viewing, recording, downloading, sharing, embedding, redistributing, or otherwise using third-party content is permitted under the laws, licences, contractual terms, and platform rules applicable to them.

Fancode-Corner does not grant users any licence or authorization to use third-party content.

Fancode-Corner does not authorize or encourage circumvention of:

- DRM
- Authentication or access controls
- Paywalls
- Geographic restrictions
- Copyright protections
- Other technical restrictions imposed by content providers

For the complete legal notice, see [`DISCLAIMER.md`](DISCLAIMER.md).

> **Important:** A disclaimer is an acknowledgement of responsibility. It does not itself make potentially infringing conduct lawful and does not grant rights to third-party content.

## 🧱 Architecture

```text
Browser
   │
   ├── Legal Notice & Agreement
   │
   ├── App / Client Verification
   │
   ├── Daily Passcode
   │
   ├── Ad-block / DNS check
   │
   ▼
/api/access-check
   │
   ├── Client IP detection
   ├── Optional ipapi.is verification
   ├── VPN / proxy / Tor / datacenter detection
   ├── Signed HMAC access token
   └── HttpOnly Secure cookie
   │
   ▼
/api/streams
   │
   ├── FanCode upstream
   └── SonyLIV upstream
   │
   ▼
Normalized live-event JSON
   │
   ▼
Sports Corner UI
```

## 📁 Project Structure

```text
Fancode-Corner/
├── api/
│   ├── access-check.js    # Access and network verification
│   └── streams.js         # Live-event aggregation API
├── index.html             # Frontend/UI, legal gate and access flow
├── DISCLAIMER.md          # Full legal disclaimer
├── vercel.json             # Vercel configuration
├── .gitignore
└── e2675e44dd562a779646.txt
```

## 🔐 Access Verification

The frontend calls:

```text
GET /api/access-check
```

The API:

1. Determines the client's IP address.
2. Checks for an existing `sc_access` cookie.
3. Validates the cookie expiry, IP hash and HMAC signature.
4. Optionally checks the IP through `ipapi.is`.
5. Can reject VPN, proxy, Tor, datacenter and privacy-relay connections.
6. Creates a new signed access cookie when access is permitted.

The current access-token lifetime is **30 minutes**.

### Environment Variables

Configure these in the Vercel project settings:

| Variable | Purpose | Required |
|---|---|---|
| `ACCESS_SECRET` | HMAC signing secret for access tokens | Yes |
| `IPAPI_KEY` | API key for IP/network classification | Recommended |
| `ACCESS_STRICT` | Controls behavior when IP verification fails | Optional |

Example:

```env
ACCESS_SECRET=your-long-random-secret
IPAPI_KEY=your-ipapi-key
ACCESS_STRICT=false
```

**Never commit real secrets or API keys to GitHub.**

## 📡 Streams API

The frontend requests:

```text
GET /api/streams
```

The endpoint requires a valid access cookie.

The backend retrieves live-event information from the configured FanCode and SonyLIV upstream sources and normalizes the data into a common format.

### Response

A successful response follows this general structure:

```json
{
  "status": "success",
  "sources": {
    "fancode": {
      "available": true,
      "error": null
    },
    "sonyliv": {
      "available": true,
      "error": null
    }
  },
  "count": 1,
  "matches": [
    {
      "title": "Live Event",
      "stream_url": "https://example.com/stream.m3u8",
      "src_image": "https://example.com/image.jpg",
      "source": "fancode",
      "category": "Sports",
      "status": "LIVE"
    }
  ]
}
```

Only records containing usable HLS `.m3u8` URLs are returned by the current processing logic.

## 🧹 Stream Processing

### FanCode

FanCode events are processed by:

- Keeping events whose status is `LIVE`.
- Selecting an available stream URL from supported upstream fields.
- Requiring an `.m3u8` URL.
- Normalizing event metadata.
- Removing duplicate events.

### SonyLIV

SonyLIV events are processed by:

- Keeping events where `isLive === true`.
- Selecting an available stream URL.
- Requiring an `.m3u8` URL.
- Grouping duplicate content variants.
- Preferring English variants when multiple language versions exist.
- Removing duplicates.

### Output Ordering

Events are sorted with FanCode events before SonyLIV events and then by title.

The backend also contains recovery logic for truncated SonyLIV JSON responses. It attempts to recover only complete JSON objects already present in the upstream response rather than fabricating missing records.

## 🎨 Frontend

The frontend is implemented as a single `index.html` containing the HTML, CSS and JavaScript.

No React, Next.js, or frontend build system is required.

### Interface

The current UI includes:

- Sticky navigation
- Sports Corner branding
- Live-event counter
- Hero section
- Category filter bar
- FanCode Live section
- SonyLIV Live section
- Refresh button
- Responsive event cards
- LIVE badges
- Source badges
- Stream-copy button
- Toast notifications
- Mobile-specific layout
- Fallback event artwork
- Legal Notice & User Agreement gate
- Daily passcode gate

## 🔎 Category Filtering

The frontend currently provides:

```text
All Live
Cricket
Football
Racing
Other
```

Classification is performed client-side using title-based pattern matching.

### Cricket

The current matching logic recognizes terms such as:

```text
T20
ODI
Test
Tour
Trophy
Blast
League
KCC
TNPL
IPL
BBL
Cricket
Hockey
```

### Football

Examples include:

```text
EFL
Championship
FC
United
City
Premier
Liga
Soccer
Football
Copa
```

### Racing

Examples include:

```text
Grand Prix
F1
Formula
Racing
MotoGP
NASCAR
```

Anything that does not match the above categories is placed under **Other**.

## 📱 Android Player Integration

The **Open in App** button creates an Android intent targeting:

```text
com.genuine.leone
```

The stream URL is passed to the external player.

A browser fallback URL is also included in the Android intent.

The interface currently links to the corresponding Google Play application page.

## 📋 Copy Stream URL

Every event card provides a copy button.

The frontend uses the browser Clipboard API:

```javascript
navigator.clipboard.writeText(...)
```

A toast notification informs the user whether copying succeeded or failed.

## 🚫 Ad-Block / DNS Filtering Detection

Before the site unlocks, the frontend performs client-side filtering checks.

If required network resources are blocked, the visitor receives a generic network-filtering message rather than detailed probe/domain information.

The user-facing message is intentionally kept generic:

```text
🚫 DNS BLOCKED
Network filtering is preventing the site from connecting.
Please disable your DNS/ad-blocking filter and try again.
```

This is **client-side detection only** and should not be considered a security boundary.

## 💰 Advertising

The current `index.html` contains a **HilltopAds popunder integration**.

The embedded advertising configuration controls the popunder behavior.

If the advertising provider or configuration changes, the corresponding code in `index.html` should also be updated.

## 📊 Analytics

The frontend currently includes Vercel Web Analytics:

```text
/_vercel/insights/script.js
```

Review Vercel's analytics/privacy configuration separately if the site's privacy requirements change.

## ☁️ Deployment

The project is designed to run on **Vercel**.

### Deploy from GitHub

1. Push the repository to GitHub.
2. Import the repository into Vercel.
3. Select the `main` branch.
4. Add the required environment variables.
5. Deploy.

The frontend does not require a build step.

The `/api` directory contains the serverless functions used by Vercel.

## ⚙️ Vercel Configuration

The current `vercel.json`:

- Enables clean URLs.
- Adds:

```text
Access-Control-Allow-Origin: *
```

The streams endpoint additionally uses:

```text
s-maxage=30
stale-while-revalidate=60
```

Access-verification responses use:

```text
Cache-Control: no-store
```

## 🔧 Local Development

Because the project uses Vercel serverless functions, a Vercel-compatible development environment is recommended.

Install the Vercel CLI:

```bash
npm install -g vercel
```

Run:

```bash
vercel dev
```

Configure the required environment variables before testing the protected API endpoints.

## 🛡️ Security Notes

### Keep `ACCESS_SECRET` private

`ACCESS_SECRET` is used to generate HMAC signatures for access tokens.

Use a long, random value.

### Daily passcode

The current daily passcode is implemented in client-side JavaScript.

Therefore:

> The passcode is not a secure secret.

Anyone who can inspect the delivered JavaScript can potentially discover it.

For real authentication, passcode verification should be moved completely to the server.

### Legal agreement

The legal agreement is a user acknowledgement and should not be treated as authentication or a cryptographic security control.

The acceptance record is stored locally in the visitor's browser and can be cleared or modified by the visitor.

### IP-based access

The access token is bound to the detected client IP.

This can cause legitimate users to lose access when their public IP changes, which can happen with:

- Mobile networks
- Carrier NAT
- Some broadband connections
- Corporate networks
- Privacy services

### Ad-block/DNS detection

The filtering check is a client-side mechanism and can be bypassed.

It should not be treated as authentication or security.

### CORS

The current Vercel configuration allows:

```text
Access-Control-Allow-Origin: *
```

If the API should only be consumed by this website, consider restricting CORS to trusted origins.

## 🧠 ACCESS_STRICT Behavior

`ACCESS_STRICT` determines what happens when the IP-verification provider cannot be reached.

### `false`

```env
ACCESS_STRICT=false
```

The access system fails open when the verification provider encounters an error.

### `true`

```env
ACCESS_STRICT=true
```

The access system fails closed and denies access when verification is unavailable.

Example:

```text
IP provider unavailable
        │
        ├── ACCESS_STRICT=false → Allow
        │
        └── ACCESS_STRICT=true  → Block
```

## 🧪 Troubleshooting

### Access system is not configured

If you see:

```text
Access system is not configured.
```

Check that:

```text
ACCESS_SECRET
```

has been configured in Vercel.

After changing environment variables, redeploy the project.

### Network verification unavailable

If `IPAPI_KEY` is configured but the provider cannot be reached:

```text
ACCESS_STRICT=false
```

allows the request to continue.

```text
ACCESS_STRICT=true
```

blocks the request.

### No live events

Open:

```text
/api/streams
```

and inspect the response.

The response contains source availability information that can help identify whether FanCode or SonyLIV is unavailable.

Upstream event data can change independently of this project.

### Stream does not play

The backend currently expects HLS URLs containing:

```text
.m3u8
```

Playback can still fail because of:

- Upstream stream availability
- Expired stream URLs
- HLS compatibility
- CORS restrictions
- Network restrictions
- External player compatibility
- Provider-side changes

## 🚀 Possible Future Improvements

Potential improvements include:

- Move daily passcode verification completely server-side.
- Add API rate limiting.
- Add request logging and monitoring.
- Add stronger CORS restrictions.
- Add source-health monitoring.
- Add automated tests for stream normalization.
- Add configurable external players.
- Add better event classification.
- Add stream freshness indicators.
- Add automated API health checks.
- Add a PWA manifest/service worker if offline support is required.

## ⚖️ Content, Rights & Legal Notice

Fancode-Corner is an aggregation/interface project. It does not claim ownership of third-party streams, stream URLs, event information, images, logos, trademarks, or other proprietary material referenced through configured upstream sources.

Third-party resources may be operated by independent services and may be subject to separate licensing arrangements, terms of service, geographic restrictions, authentication requirements, copyright rules, and other access controls.

### User Responsibility

Operators and users are responsible for determining whether their use of any third-party resource complies with applicable:

- Copyright and intellectual-property laws
- Broadcasting and licensing requirements
- Platform/service terms
- Geographic or territorial restrictions
- Permissions and licences
- Other applicable legal requirements

Fancode-Corner does not grant a licence or authorization to use third-party content and does not authorize circumvention of DRM, authentication, paywalls, geographic restrictions, copyright protections, or other technical access controls.

### No Ownership or Affiliation

The appearance of third-party names, logos, trademarks, event information, or streaming references does not imply ownership, sponsorship, endorsement, partnership, or affiliation unless expressly stated.

### Rights Complaints

Rights holders or authorized representatives with a legitimate concern about a reference presented by the project may contact the project operator with sufficient information to identify the material and explain the basis of the request. Where appropriate, the relevant reference may be reviewed and removed or disabled.

### Full Disclaimer

See [`DISCLAIMER.md`](DISCLAIMER.md) for the complete legal notice, including third-party services, user responsibility, no-circumvention language, rights complaints, trademarks, limitation of responsibility, and notice updates.

> This documentation is informational and is not legal advice. A disclaimer does not itself make potentially infringing conduct lawful.

## 📄 License

No license file is currently included in this repository.

Unless a license is added, the repository should **not** be assumed to grant permission to copy, modify, redistribute, or commercially use the code.

---

Built as a lightweight live-sports aggregation interface using a static HTML frontend and Vercel serverless APIs.

This README is intended to document the current Fancode-Corner architecture, access flow, and legal-notice requirements.
