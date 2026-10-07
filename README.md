# Fancode-Corner — Shaka Player migration

## Changes

- Replaces Fluid Player with **Shaka Player 5.2.12**.
- HLS `.m3u8` and DASH `.mpd` are handled by Shaka.
- Ordinary media URLs use the browser's native video element.
- Adds retry/buffering configuration and a 15-second startup failure message.
- Keeps the existing NS Player fallback (`com.genuine.leone`).
- Keeps the existing HilltopAds code untouched.
- Fixes the StreamFree embed fallback so an embed/player page is opened as a webpage instead of being passed to NS Player as HLS.
- Applies the same migration to `player.html`.
- Does not bypass DRM, authentication, signing, paywalls, geo restrictions, or other access controls.

## Apply

Copy `apply_shaka_migration.py` into the root of `Fancode-Corner`, then run:

```bash
python apply_shaka_migration.py
git diff -- index.html player.html
git add index.html player.html
git commit -m "Replace Fluid Player with Shaka Player"
git push
```

The Shaka dependency is pinned to 5.2.12.
