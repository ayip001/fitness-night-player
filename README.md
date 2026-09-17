# Fitness Night Player

Midnight Runners player with a hardcoded 9 second crossfade. Tabata is not included.

Audio is served temporarily from the prologue.run R2 bucket (`tmp-fitness-night/`) at `https://images.prologue.run`. The phone downloads every track **once** into IndexedDB, then plays only from that cache.

The MP3s are gitignored and are not on GitHub. Delete the R2 prefix after the event.

## iPhone

1. Open https://ayip001.github.io/fitness-night-player/ in Safari.
2. Wait until all 35 tracks show **Cached**.
3. Share → **Add to Home Screen**.
4. Tap **Play** once, then lock the phone.

After that, playback does not stream. Keep the home-screen app running; don’t force-quit it during the event.
