# Fitness Night Player

Temporary private GitHub Pages player for a fitness event. It plays two playlists in order, with a hardcoded 9 second crossfade, and is built for iOS Safari lock-screen playback.

It does **not** download Spotify audio. Load files you already have the right to play. Those files stay in this phone's browser storage, not in the repo.

## Playlists

- **Midnight Runners** — 35 tracks from the special playlist
- **Tabata** — first 100 tracks from the Tabata playlist

No shuffle. Missing tracks are skipped.

## iPhone setup

1. Open the GitHub Pages URL in Safari.
2. Share → **Add to Home Screen**.
3. Put the audio in the Files app.
4. Open the home-screen app, pick a playlist, then **Load files (match titles)** or **Load files in order**.
5. Tap **Play** once while the screen is on.
6. Lock the phone. iOS should keep the audio going and show lock-screen controls.

Keep Safari from discarding the page: don't force-quit the home-screen app during the event.

## Local preview

```powershell
python -m http.server 4173
```

Then open `http://127.0.0.1:4173`.
