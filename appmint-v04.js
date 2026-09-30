/*
 * Sports Corner v0.4 — AppMint native enhancements.
 * Safe in a normal browser: every native call is feature-detected.
 */
(() => {
    'use strict';

    const bridge = () => window.WebToApk || null;

    const AppMintV04 = {
        isNative() {
            return Boolean(bridge());
        },

        click() {
            const b = bridge();
            if (b && typeof b.playClick === 'function') {
                try { b.playClick(); } catch (_) {}
            }
        },

        haptic(duration = 25) {
            const b = bridge();
            if (b && typeof b.vibrate === 'function') {
                try { b.vibrate(duration); return; } catch (_) {}
            }
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate(duration); } catch (_) {}
            }
        },

        fullscreen(enabled) {
            const b = bridge();
            if (b && typeof b.setFullscreen === 'function') {
                try { return Boolean(b.setFullscreen(Boolean(enabled))); } catch (_) {}
            }

            if (enabled && document.documentElement.requestFullscreen) {
                return document.documentElement.requestFullscreen().then(() => true).catch(() => false);
            }

            if (!enabled && document.exitFullscreen) {
                return document.exitFullscreen().then(() => true).catch(() => false);
            }

            return false;
        },

        toggleFullscreen() {
            const b = bridge();
            if (b && typeof b.toggleFullscreen === 'function') {
                try { return Boolean(b.toggleFullscreen()); } catch (_) {}
            }
            return this.fullscreen(!this.isFullscreen());
        },

        isFullscreen() {
            const b = bridge();
            if (b && typeof b.isFullscreen === 'function') {
                try { return Boolean(b.isFullscreen()); } catch (_) {}
            }
            return Boolean(document.fullscreenElement);
        },

        pip() {
            const b = bridge();
            if (b && typeof b.enterPip === 'function') {
                try { return Boolean(b.enterPip()); } catch (_) {}
            }
            return false;
        },

        async videoPip(video) {
            if (!video) return false;

            if (document.pictureInPictureElement && document.exitPictureInPicture) {
                try {
                    await document.exitPictureInPicture();
                    return true;
                } catch (_) {}
            }

            if (typeof video.requestPictureInPicture === 'function') {
                try {
                    await video.requestPictureInPicture();
                    return true;
                } catch (_) {}
            }

            return this.pip();
        },

        async share(title, text, url) {
            const b = bridge();
            const target = url || location.href;

            if (b && typeof b.shareNative === 'function') {
                try {
                    b.shareNative(String(title || ''), String(text || ''), String(target));
                    return true;
                } catch (_) {}
            }

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: String(title || ''),
                        text: String(text || ''),
                        url: String(target)
                    });
                    return true;
                } catch (_) {}
            }

            if (navigator.clipboard) {
                try {
                    await navigator.clipboard.writeText(String(target));
                    return 'copied';
                } catch (_) {}
            }

            return false;
        },

        setBadge(count) {
            const n = Math.max(0, Number(count) || 0);
            try {
                if (navigator.setAppBadge) {
                    return navigator.setAppBadge(n);
                }
            } catch (_) {}
            return false;
        },

        clearBadge() {
            try {
                if (navigator.clearAppBadge) {
                    return navigator.clearAppBadge();
                }
            } catch (_) {}
            return false;
        }
    };

    window.AppMintV04 = AppMintV04;

    // Native-feeling feedback for semantic buttons only.
    document.addEventListener('click', event => {
        const target = event.target.closest?.('button[data-appmint-haptic], .appmint-action');
        if (!target) return;
        AppMintV04.haptic(22);
        AppMintV04.click();
    }, { passive: true });
})();
