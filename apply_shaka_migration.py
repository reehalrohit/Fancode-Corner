
#!/usr/bin/env python3

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

def patch_index():
    path = ROOT / "index.html"
    text = path.read_text(encoding="utf-8")

    old_head = """    <!-- Fluid Player -->
    <link rel="stylesheet" href="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.css">
    <script src="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js"></script>"""
    new_head = """    <!-- Shaka Player 5.2.12 -->
    <!-- HLS/DASH adaptive streaming player. -->
    <script defer src="https://ajax.googleapis.com/ajax/libs/shaka-player/5.2.12/shaka-player.compiled.js"></script>"""
    text = replace_once(text, old_head, new_head, "index.html player dependency")

    for old, new in [
        ("/* Fluid Player modal */", "/* Shaka Player modal */"),
        (".fluid-modal", ".player-modal"),
        (".fluid-player-shell", ".player-shell"),
        (".fluid-player-head", ".player-head"),
        (".fluid-player-title", ".player-title"),
        (".fluid-live-badge", ".player-live-badge"),
        (".fluid-close", ".player-close"),
        (".fluid-video-wrap", ".player-video-wrap"),
        ("#fluid-video", "#player-video"),
        (".fluid-player-status", ".player-status"),
        (".fluid-player-actions", ".player-actions"),
        ('id="fluid-modal"', 'id="player-modal"'),
        ('class="fluid-modal"', 'class="player-modal"'),
        ('class="fluid-player-shell"', 'class="player-shell"'),
        ('class="fluid-player-head"', 'class="player-head"'),
        ('class="fluid-live-badge"', 'class="player-live-badge"'),
        ('id="fluid-player-title"', 'id="player-title"'),
        ('class="fluid-player-title"', 'class="player-title"'),
        ('id="fluid-close"', 'id="player-close"'),
        ('class="fluid-close"', 'class="player-close"'),
        ('class="fluid-video-wrap"', 'class="player-video-wrap"'),
        ('id="fluid-player-status"', 'id="player-status"'),
        ('class="fluid-player-status"', 'class="player-status"'),
        ('class="fluid-player-actions"', 'class="player-actions"'),
        ('id="fluid-external"', 'id="player-external"'),
        ('id="fluid-video"', 'id="player-video"'),
    ]:
        text = text.replace(old, new)

    text = text.replace("Fluid Player", "Shaka Player")

    start_marker = "        let fluidPlayerInstance = null;"
    end_marker = "        async function fetchStreams(manual = false) {"
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError("index.html: old player implementation block not found")

    player_block = r"""        let shakaPlayerInstance = null;
        let activePlayerStream = '';
        let playerStartupTimer = null;

        function isHlsStream(url) {
            return /\.m3u8(?:$|[?#])/i.test(url);
        }

        function isDashStream(url) {
            return /\.mpd(?:$|[?#])/i.test(url);
        }

        function isAdaptiveStream(url) {
            return isHlsStream(url) || isDashStream(url);
        }

        async function closePlayer() {
            clearTimeout(playerStartupTimer);
            playerStartupTimer = null;

            const modal = document.getElementById('player-modal');
            if (modal) modal.classList.remove('open');

            if (shakaPlayerInstance) {
                try {
                    await shakaPlayerInstance.destroy();
                } catch (error) {
                    console.debug('Shaka Player destroy:', error);
                }
                shakaPlayerInstance = null;
            }

            const video = document.getElementById('player-video');
            if (video) {
                try { video.pause(); } catch (error) { console.debug('Video pause:', error); }
                try {
                    video.removeAttribute('src');
                    video.load();
                } catch (error) {
                    console.debug('Video cleanup:', error);
                }
            }

            activePlayerStream = '';
        }

        function openInNSPlayer(streamUrl) {
            if (!streamUrl) {
                showToast('❌ No stream URL available.');
                return;
            }

            const cleanUrl = String(streamUrl).trim().replace(/^https?:\/\//i, '');
            const intentUrl =
                `intent://${cleanUrl}` +
                `#Intent;action=android.intent.action.VIEW;` +
                `package=com.genuine.leone;` +
                `scheme=https;` +
                `S.browser_fallback_url=${encodeURIComponent(streamUrl)};end;`;

            let leftPage = false;
            const onVisibility = () => {
                if (document.visibilityState === 'hidden') {
                    leftPage = true;
                    document.removeEventListener('visibilitychange', onVisibility);
                }
            };
            document.addEventListener('visibilitychange', onVisibility);

            const link = document.createElement('a');
            link.href = intentUrl;
            link.rel = 'noopener';
            link.style.position = 'fixed';
            link.style.left = '-10000px';
            link.style.top = '-10000px';
            document.body.appendChild(link);

            try { link.click(); }
            catch (error) { console.warn('NS Player anchor launch failed:', error); }

            setTimeout(() => {
                if (!leftPage && document.visibilityState === 'visible') {
                    try { window.location.href = intentUrl; }
                    catch (error) { console.warn('NS Player intent launch failed:', error); }
                }
            }, 350);

            setTimeout(() => {
                link.remove();
                document.removeEventListener('visibilitychange', onVisibility);
            }, 2500);
        }

        async function openShakaPlayer(streamUrl, title) {
            if (!streamUrl) {
                showToast('❌ No playable stream available.');
                return;
            }

            if (!window.shaka) {
                showToast('⏳ Shaka Player is still loading. Try again in a moment.');
                return;
            }

            const modal = document.getElementById('player-modal');
            const video = document.getElementById('player-video');
            const titleEl = document.getElementById('player-title');
            const status = document.getElementById('player-status');

            if (!modal || !video || !titleEl || !status) {
                console.error('[Sports Corner] Player UI is incomplete.');
                showToast('❌ Player UI failed to initialize.');
                return;
            }

            await closePlayer();

            activePlayerStream = String(streamUrl).trim();
            titleEl.textContent = title || 'Live Sports';
            status.textContent = isAdaptiveStream(activePlayerStream)
                ? 'Loading adaptive live stream…'
                : 'Loading media…';
            modal.classList.add('open');

            try {
                shaka.polyfill.installAll();

                if (!shaka.Player.isBrowserSupported()) {
                    throw new Error('Browser media support required by Shaka Player is unavailable.');
                }

                shakaPlayerInstance = new shaka.Player(video);

                shakaPlayerInstance.addEventListener('error', (event) => {
                    const detail = event && event.detail ? event.detail : event;
                    console.error('[Sports Corner] Shaka playback error:', detail);
                    status.textContent = 'Playback error. Try NS Player.';
                });

                shakaPlayerInstance.configure({
                    streaming: {
                        rebufferingGoal: 2,
                        bufferingGoal: 10,
                        bufferBehind: 30,
                        retryParameters: {
                            maxAttempts: 4,
                            baseDelay: 500,
                            backoffFactor: 2,
                            fuzzFactor: 0.5,
                            timeout: 15000
                        }
                    },
                    abr: {
                        enabled: true,
                        defaultBandwidthEstimate: 4000000
                    }
                });

                if (isAdaptiveStream(activePlayerStream)) {
                    await shakaPlayerInstance.load(activePlayerStream);
                } else {
                    video.src = activePlayerStream;
                    await new Promise((resolve, reject) => {
                        const onLoaded = () => cleanup(resolve);
                        const onError = () => cleanup(() => reject(new Error('Browser media load failed.')));
                        const cleanup = (fn) => {
                            video.removeEventListener('loadedmetadata', onLoaded);
                            video.removeEventListener('error', onError);
                            fn();
                        };
                        video.addEventListener('loadedmetadata', onLoaded, { once: true });
                        video.addEventListener('error', onError, { once: true });
                        video.load();
                    });
                }

                status.textContent = 'Player ready • stream loaded';

                playerStartupTimer = setTimeout(() => {
                    if (video.readyState < 2 && video.currentTime === 0) {
                        status.textContent = 'Stream is not starting. Try NS Player.';
                    }
                }, 15000);

                try {
                    await video.play();
                    clearTimeout(playerStartupTimer);
                } catch (playError) {
                    console.debug('[Sports Corner] Play request:', playError);
                    status.textContent = 'Stream loaded • tap Play to start';
                }
            } catch (error) {
                console.error('[Sports Corner] Shaka Player initialization failed:', error);
                status.textContent = 'Unable to play this stream in the browser. Try NS Player.';
            }
        }

        document.getElementById('player-close').addEventListener('click', closePlayer);
        document.getElementById('player-external').addEventListener('click', () => {
            if (activePlayerStream) openInNSPlayer(activePlayerStream);
        });
        document.getElementById('player-modal').addEventListener('click', (event) => {
            if (event.target.id === 'player-modal') closePlayer();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closePlayer();
        });

"""
    text = text[:start] + player_block + text[end:]
    text = re.sub(r"\bopenFluidPlayer\b", "openShakaPlayer", text)
    text = re.sub(r"\bcloseFluidPlayer\b", "closePlayer", text)

    # Safe StreamFree fallback.
    text = text.replace(
"""const primaryLabel =
            isStreamFree && (hasPlayableStream || hasEmbedLink)
                ? '▶ Open in NS Player'
                : hasPlayableStream
                    ? '▶ Watch Here'
                    : hasEmbedLink
                        ? '▶ Open in NS Player'
                        : hasOfficialLink
                            ? '↗ Open Official'
                            : 'Unavailable';""",
"""const primaryLabel =
            isStreamFree && hasPlayableStream
                ? '▶ Open in NS Player'
                : isStreamFree && hasEmbedLink
                    ? '▶ Open StreamFree Player'
                    : hasPlayableStream
                        ? '▶ Watch Here'
                        : hasEmbedLink
                            ? '▶ Open Stream'
                            : hasOfficialLink
                                ? '↗ Open Official'
                                : 'Unavailable';"""
    )
    text = text.replace(
"""buttons[0].addEventListener('click', () => {
            if (isStreamFree && (hasPlayableStream || hasEmbedLink)) {
                openInNSPlayer(streamUrl || embedUrl);
                return;
            }

            if (hasPlayableStream) {
                openShakaPlayer(streamUrl, match.title || 'Live Sports');
                return;
            }

            if (hasEmbedLink) {
                openInNSPlayer(embedUrl);
                return;
            }""",
"""buttons[0].addEventListener('click', () => {
            if (isStreamFree) {
                if (hasPlayableStream) {
                    openInNSPlayer(streamUrl);
                } else if (hasEmbedLink) {
                    openStreamFreePlayer(embedUrl);
                } else {
                    showToast('❌ No StreamFree player URL available.');
                }
                return;
            }

            if (hasPlayableStream) {
                openShakaPlayer(streamUrl, match.title || 'Live Sports');
                return;
            }

            if (hasEmbedLink) {
                window.open(embedUrl, '_blank', 'noopener,noreferrer');
                return;
            }"""
    )
    text = text.replace(
"""buttons[1].addEventListener('click', () => {
            if (isStreamFree && (hasPlayableStream || hasEmbedLink)) {
                openInNSPlayer(streamUrl || embedUrl);
                return;
            }

            if (hasPlayableStream) {
                openInNSPlayer(streamUrl);
                return;
            }

            if (hasEmbedLink) {
                openInNSPlayer(embedUrl);
                return;
            }""",
"""buttons[1].addEventListener('click', () => {
            if (isStreamFree) {
                if (hasPlayableStream) {
                    openInNSPlayer(streamUrl);
                } else if (hasEmbedLink) {
                    openStreamFreePlayer(embedUrl);
                } else {
                    showToast('❌ No StreamFree player URL available.');
                }
                return;
            }

            if (hasPlayableStream) {
                openInNSPlayer(streamUrl);
                return;
            }

            if (hasEmbedLink) {
                window.open(embedUrl, '_blank', 'noopener,noreferrer');
                return;
            }"""
    )
    if "function openStreamFreePlayer" not in text:
        marker = "function showToast(message) {"
        helper = """function openStreamFreePlayer(embedUrl) {
    if (!embedUrl) {
        showToast('❌ No StreamFree player URL available.');
        return;
    }

    let opened = null;
    try {
        opened = window.open(embedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
        console.warn('StreamFree player window launch failed:', error);
    }

    if (!opened) {
        try {
            window.location.href = embedUrl;
        } catch (error) {
            console.warn('StreamFree player navigation failed:', error);
            showToast('❌ Unable to open StreamFree Player.');
        }
    }
}

"""
        if marker in text:
            text = text.replace(marker, helper + marker, 1)

    forbidden = ["cdn.fluidplayer.com", "fluidPlayer", "fluid-modal",
                 "fluid-video", "fluid-player", "Fluid Player"]
    leftovers = [x for x in forbidden if x in text]
    if leftovers:
        raise RuntimeError("index.html still contains: " + ", ".join(leftovers))

    path.write_text(text, encoding="utf-8")
    return path

def patch_player():
    path = ROOT / "player.html"
    text = path.read_text(encoding="utf-8")

    old_head = """    <link rel="stylesheet"
          href="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.css">
    <script src="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js"></script>"""
    new_head = """    <!-- Shaka Player 5.2.12 -->
    <script src="https://ajax.googleapis.com/ajax/libs/shaka-player/5.2.12/shaka-player.compiled.js"></script>"""
    text = replace_once(text, old_head, new_head, "player.html player dependency")

    text = re.sub(
        r"""
        \n        \.fluid_video_wrapper \{.*?
        \n        \}\n\n        \.fluid_video_wrapper video \{.*?
        \n        \}\n""",
        "\n",
        text,
        flags=re.S | re.X,
    )

    start_marker = "    let player = null;"
    end_marker = '    shareBtn.addEventListener("click", async () => {'
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise RuntimeError("player.html: player implementation block not found")

    new_js = r"""    let player = null;
    let started = false;
    let startupTimer = null;

    document.title = `${title} | Live Player`;
    liveTitle.textContent = source ? `${source} • ${title}` : title;

    if (poster) video.poster = poster;

    function showLoading(message) {
        loadingDetail.textContent = message || "Preparing the stream…";
        loading.classList.remove("hidden");
        errorOverlay.classList.add("hidden");
    }

    function hideLoading() {
        loading.classList.add("hidden");
    }

    function showError(message) {
        clearTimeout(startupTimer);
        hideLoading();
        errorText.textContent = message;
        errorOverlay.classList.remove("hidden");
    }

    function isAdaptiveUrl(url) {
        try {
            const u = new URL(url);
            if (u.protocol !== "https:" && u.protocol !== "http:") return false;
            return /\.(m3u8|mpd)(?:$|[?#])/i.test(u.pathname + u.search);
        } catch {
            return false;
        }
    }

    function describeError() {
        const e = video.error;
        if (!e) return "The browser could not start the stream.";

        if (e.code === MediaError.MEDIA_ERR_NETWORK) {
            return "The browser could not fetch the stream. The source may require browser access permission or request headers.";
        }
        if (e.code === MediaError.MEDIA_ERR_DECODE) {
            return "The stream was received but the browser could not decode it.";
        }
        if (e.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
            return "This media source is not playable by the browser.";
        }
        if (e.code === MediaError.MEDIA_ERR_ABORTED) {
            return "The browser aborted the stream request.";
        }

        return "The browser reported a playback error.";
    }

    function openNSPlayer() {
        if (!streamUrl) return;

        const cleanUrl = streamUrl.replace(/^https?:\/\//i, "");
        const intent =
            `intent://${cleanUrl}` +
            `#Intent;package=com.genuine.leone;` +
            `action=android.intent.action.VIEW;` +
            `scheme=https;` +
            `S.browser_fallback_url=${encodeURIComponent(streamUrl)};end;`;

        location.href = intent;
    }

    async function destroyPlayer() {
        clearTimeout(startupTimer);

        if (player && typeof player.destroy === "function") {
            try {
                await player.destroy();
            } catch (error) {
                console.debug("Shaka Player destroy:", error);
            }
        }

        player = null;

        try { video.pause(); } catch (error) {
            console.debug("Video pause:", error);
        }

        try {
            video.removeAttribute("src");
            video.load();
        } catch (error) {
            console.debug("Video cleanup:", error);
        }
    }

    async function init() {
        clearTimeout(startupTimer);
        started = false;

        if (!streamUrl) {
            showError("No stream URL was supplied.");
            return;
        }

        if (typeof shaka === "undefined") {
            showError("Shaka Player could not be loaded. Check the network connection and retry.");
            return;
        }

        if (!shaka.Player.isBrowserSupported()) {
            showError("This browser does not provide the media features required by Shaka Player.");
            return;
        }

        await destroyPlayer();
        showLoading(isAdaptiveUrl(streamUrl)
            ? "Connecting to the adaptive live stream…"
            : "Connecting to the media source…");

        try {
            shaka.polyfill.installAll();
            player = new shaka.Player(video);

            player.addEventListener("error", event => {
                console.error("Shaka Player error:", event.detail || event);
                if (!started) {
                    showError("The stream could not be played in the browser. Try NS Player.");
                }
            });

            player.configure({
                streaming: {
                    rebufferingGoal: 2,
                    bufferingGoal: 10,
                    bufferBehind: 30,
                    retryParameters: {
                        maxAttempts: 4,
                        baseDelay: 500,
                        backoffFactor: 2,
                        fuzzFactor: 0.5,
                        timeout: 15000
                    }
                },
                abr: {
                    enabled: true,
                    defaultBandwidthEstimate: 4000000
                }
            });

            if (isAdaptiveUrl(streamUrl)) {
                await player.load(streamUrl);
            } else {
                video.src = streamUrl;
                await new Promise((resolve, reject) => {
                    const onLoaded = () => cleanup(resolve);
                    const onError = () => cleanup(() => reject(new Error("Media load failed.")));
                    const cleanup = fn => {
                        video.removeEventListener("loadedmetadata", onLoaded);
                        video.removeEventListener("error", onError);
                        fn();
                    };
                    video.addEventListener("loadedmetadata", onLoaded, { once: true });
                    video.addEventListener("error", onError, { once: true });
                    video.load();
                });
            }

            startupTimer = setTimeout(() => {
                if (!started && video.readyState < 2) {
                    showError("The stream did not start in the browser. Try NS Player.");
                }
            }, 15000);

            try {
                await video.play();
            } catch (_) {
                loadingDetail.textContent = "Stream is ready. Press the play button to start playback.";
            }
        } catch (err) {
            console.error("Shaka Player initialization error:", err);
            showError("Shaka Player could not start this stream. Try NS Player.");
        }
    }

"""
    text = text[:start] + new_js + text[end:]
    text = text.replace("Preparing the HLS player…", "Preparing the stream…")
    text = text.replace("HLS player", "stream player")
    text = text.replace("HLS source", "stream source")
    text = text.replace("Fluid Player", "Shaka Player")

    leftovers = ["cdn.fluidplayer.com", "fluidPlayer", "fluid_video_wrapper",
                 "fluid-video", "Fluid Player"]
    found = [x for x in leftovers if x in text]
    if found:
        raise RuntimeError("player.html still contains: " + ", ".join(found))

    path.write_text(text, encoding="utf-8")
    return path

def main():
    print("Patched:", patch_index())
    print("Patched:", patch_player())
    print("Done. Shaka Player 5.2.12 now handles HLS/DASH, with native media fallback.")

if __name__ == "__main__":
    main()
