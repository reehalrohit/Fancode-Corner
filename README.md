

# 🏟️ Sports Corner

A lightweight, mobile-first live sports aggregation website that presents currently live events from FanCode and SonyLIV in a single interface.

**Live site:** [https://fancode-corner.vercel.app/](https://fancode-corner.vercel.app/)
**Repository:** [https://github.com/reehalrohit/Fancode-Corner](https://github.com/reehalrohit/Fancode-Corner)

## ✨ Features

* 🏏 FanCode live-event section
* 📺 SonyLIV live-event section
* 🔴 Live-only event filtering
* 🔎 Category filters:

  * All Live
  * Cricket
  * Football
  * Racing
  * Other
* 🔄 Manual refresh of live events
* 📱 Responsive/mobile-optimized interface
* ▶️ Android stream handoff through an external player intent
* 📋 Copy stream URL to clipboard
* 🖼️ Event artwork with fallback image
* 🔐 Server-side access verification
* 🛡️ VPN/proxy/Tor/datacenter/privacy-relay detection when configured
* 🍪 Short-lived, IP-bound signed access cookie
* 🚫 Client-side ad-block detection
* 💰 HilltopAds integration
* 📊 Vercel Web Analytics
* ⚡ Vercel serverless API architecture

## 🧱 Architecture

```text
Browser
   │
   ├── Daily passcode
   │
   ├── Ad-block check
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
├── index.html             # Complete frontend/UI
├── vercel.json            # Vercel configuration
├── .gitignore
└── e2675e44dd562a779646.txt
```

## 🔐 Access Verification

The frontend first calls:

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

| Variable        | Purpose                                      | Required    |
| --------------- | -------------------------------------------- | ----------- |
| `ACCESS_SECRET` | HMAC signing secret for access tokens        | Yes         |
| `IPAPI_KEY`     | API key for IP/network classification        | Recommended |
| `ACCESS_STRICT` | Controls behavior when IP verification fails | Optional    |

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

The backend currently retrieves live-event information from the upstream FanCode and SonyLIV data sources configured inside `api/streams.js`.

The data is normalized into a common format before being returned to the frontend.

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

* Keeping events whose status is `LIVE`.
* Selecting an available stream URL from supported upstream fields.
* Requiring an `.m3u8` URL.
* Normalizing event metadata.
* Removing duplicate events.

### SonyLIV

SonyLIV events are processed by:

* Keeping events where `isLive === true`.
* Selecting an available stream URL.
* Requiring an `.m3u8` URL.
* Grouping duplicate content variants.
* Preferring English variants when multiple language versions exist.
* Removing duplicates.

### Output ordering

Events are sorted with FanCode events before SonyLIV events and then by title.

The backend also contains recovery logic for truncated SonyLIV JSON responses. It attempts to recover only complete JSON objects already present in the upstream response rather than fabricating missing records.

## 🎨 Frontend

The frontend is implemented as a single `index.html` containing the HTML, CSS and JavaScript.

No React, Next.js or frontend build system is required.

### Interface

The current UI includes:

* Sticky navigation
* Sports Corner branding
* Live-event counter
* Hero section
* Category filter bar
* FanCode Live section
* SonyLIV Live section
* Refresh button
* Responsive event cards
* LIVE badges
* Source badges
* Stream-copy button
* Toast notifications
* Mobile-specific layout
* Fallback event artwork

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

## 🚫 Ad-Block Detection

Before the site unlocks, the frontend creates an advertising-style hidden element and checks whether browser filtering prevents it from being displayed.

If the element appears to be blocked, the site displays an error requesting that the visitor disable ad blocking/DNS filtering.

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

* Enables clean URLs.
* Adds:

```text
Access-Control-Allow-Origin: *
```

* Configures public cache/revalidation behavior.

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

### IP-based access

The access token is bound to the detected client IP.

This can cause legitimate users to lose access when their public IP changes, which can happen with:

* Mobile networks
* Carrier NAT
* Some broadband connections
* Corporate networks
* Privacy services

### Ad-block detection

The ad-block check is a client-side mechanism and can be bypassed.

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

For example:

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

* Upstream stream availability
* Expired stream URLs
* HLS compatibility
* CORS restrictions
* Network restrictions
* External player compatibility
* Provider-side changes

## 🚀 Possible Future Improvements

Potential improvements include:

* Move daily passcode verification completely server-side.
* Add API rate limiting.
* Add request logging and monitoring.
* Add stronger CORS restrictions.
* Add source-health monitoring.
* Add automated tests for stream normalization.
* Add configurable external players.
* Add better event classification.
* Add stream freshness indicators.
* Add automated API health checks.
* Add a PWA manifest/service worker if offline support is required.

## ⚖️ Content & Rights

This project is an aggregation/interface layer that retrieves information and stream URLs from configured upstream sources.

Operators and users are responsible for ensuring that their use, redistribution, embedding and presentation of streams complies with applicable laws, licenses, platform terms and content rights.

The project does not claim ownership of third-party streams, trademarks, logos or event metadata.

## 📄 License

No license file is currently included in this repository.

Unless a license is added, the repository should **not** be assumed to grant permission to copy, modify, redistribute or commercially use the code.

---

Built as a lightweight live-sports aggregation interface using a static HTML frontend and Vercel serverless APIs.

This version is specifically aligned with the current `Fancode-Corner` codebase rather than describing features the repository does not currently implement. [Fancode-Corner on GitHub](https://github.com/reehalrohit/Fancode-Corner/tree/main?utm_source=chatgpt.com)
