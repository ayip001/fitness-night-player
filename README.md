# Fitness Night Player

Temporary Midnight Runners web player for one fitness event. Sequential play only, hardcoded **9 second** crossfade, iOS Safari lock-screen playback, tap-and-drag scrubbing. Tabata was dropped.

This is a throwaway project. Audio is **not** in Git. A freshly spawned agent should read **Teardown** before deleting anything.

## Live URLs

- GitHub repo: https://github.com/ayip001/fitness-night-player (public; Pages on the free plan cannot be private)
- Pages: https://ayip001.github.io/fitness-night-player/ redirects to https://angusyeet.com/fitness-night-player/
- Custom domain comes from the **user** GitHub Pages site (`angusyeet.com`), not a CNAME in this repo

Local copy: `C:\Users\USER\Documents\Tmp\fitness-night-player`

## What was borrowed (prologue.run R2)

This player temporarily hosts 35 MP3s on the **prologue.run** Cloudflare R2 bucket. Do **not** create a new bucket. Do **not** delete `prologue-run-main`. Do **not** touch objects under `races/`.

| Item | Value |
| --- | --- |
| Source project | `C:\Users\USER\Documents\GitHub\prologue.run` |
| Env file (S3-style keys) | `prologue.run\.env.local` (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CDN_BASE_URL`) |
| Bucket | `prologue-run-main` |
| Cloudflare account | `78f3c0b13d551083c75a153e246dad69` (wrangler login as `ayip002@gmail.com`) |
| Custom domain | `https://images.prologue.run` (already connected to this bucket) |
| **Temporary prefix** | `tmp-fitness-night/` |
| Object keys | `tmp-fitness-night/01.mp3` … `tmp-fitness-night/35.mp3` |
| Public audio URL | `https://images.prologue.run/tmp-fitness-night/01.mp3` (etc.) |

Those S3 API keys were **AccessDenied** for `PutObject` / `GetBucketCors`. Uploads and CORS were done with **Wrangler OAuth**, not boto3.

Local numbered files (gitignored) live in `audio/` and were copied from `C:\Users\USER\Downloads\playlist`.

### CORS change on the shared bucket

Wrangler `r2 bucket cors set` **replaces** the whole policy. The live policy is `scripts/r2-cors.json`. It keeps prologue origins and adds player origins:

- `https://ayip001.github.io`
- `https://angusyeet.com`
- `http://angusyeet.com`
- `http://127.0.0.1:4173`
- `http://localhost:4173`

Pre-borrow prologue-only policy is saved as `scripts/r2-cors-restore.json`. Restore that on teardown so prologue.run does not keep fitness-player origins forever.

## How the player works

1. Phone opens the GitHub Pages origin over HTTPS.
2. `app.js` fetches `https://images.prologue.run/tmp-fitness-night/NN.mp3` (see `AUDIO_BASE`) into **IndexedDB** (not localStorage).
3. Playback uses blob URLs from that cache only, so the event does not stream.
4. Dual `<audio>` decks, 9s equal-power crossfade, no shuffle, Media Session + scrubber.

## iPhone

1. Open https://angusyeet.com/fitness-night-player/ in Safari (hard-refresh if an old service worker is stuck).
2. Wait until all 35 tracks show **Cached**.
3. Share → **Add to Home Screen**.
4. Tap **Play** once, then lock the phone.

Do not force-quit the home-screen app during the event.

## Teardown (only when the user says so)

Goal: remove the temp player and undo the prologue borrow. Leave prologue.run’s bucket, race images, and app CORS intact.

### 1. Delete only the borrowed R2 prefix

```powershell
wrangler login
1..35 | ForEach-Object {
  $n = '{0:00}' -f $_
  wrangler r2 object delete "prologue-run-main/tmp-fitness-night/$n.mp3" --remote
}
wrangler r2 object list prologue-run-main --prefix tmp-fitness-night/
```

Confirm the list is empty. If any extra keys appeared under that prefix, delete those too.

Do **not** run `wrangler r2 bucket delete prologue-run-main`.

`python scripts/r2_audio.py delete` will likely fail; the stored S3 keys cannot write.

### 2. Restore prologue CORS

From this repo:

```powershell
wrangler r2 bucket cors set prologue-run-main --file scripts/r2-cors-restore.json --force
wrangler r2 bucket cors list prologue-run-main
```

Expected origins after restore: `http://localhost:3000`, `https://prologue.run`, `https://www.prologue.run`, `https://prologue-run.vercel.app`, `https://staging.prologue.run`.

### 3. Remove GitHub Pages + repo

```powershell
gh api -X DELETE repos/ayip001/fitness-night-player/pages
gh repo delete ayip001/fitness-night-player --yes
```

Only delete the repo after the user confirms. Pages HTML_URL is `http://angusyeet.com/fitness-night-player/` because the **account** Pages domain is `angusyeet.com`; do not wipe that custom domain from other repos.

### 4. Local disk

- Project: `C:\Users\USER\Documents\Tmp\fitness-night-player`
- Source rips: `C:\Users\USER\Downloads\playlist`
- IndexedDB on phones that used the player: user can Clear cache in the UI, or forget the home-screen app

## Scripts

| File | Purpose |
| --- | --- |
| `scripts/r2_audio.py` | Intended upload/list/delete via prologue `.env.local` (writes were AccessDenied) |
| `scripts/r2-cors.json` | Current borrowed CORS (prologue + this player) |
| `scripts/r2-cors-restore.json` | Original prologue CORS to put back on teardown |
