const CROSSFADE_SECONDS = 9;
const SKIP_FADE_SECONDS = 0.35;
const DB_NAME = "fitness-night-player";
const DB_VERSION = 1;
const STORE_NAME = "tracks";
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

const state = {
  playlistId: "special",
  files: new Map(),
  objectUrls: new Map(),
  activeDeck: 0,
  index: 0,
  playing: false,
  unlocked: false,
  crossfade: null,
  startingFade: false,
  db: null,
};

const decks = [];
const els = {};

function currentPlaylist() {
  return window.PLAYLISTS.find((playlist) => playlist.id === state.playlistId);
}

function trackKey(playlistId, index) {
  return `${playlistId}:${index}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function setToast(message) {
  els.toast.textContent = message || "";
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i, "")
    .replace(/^\d{1,3}[\s._-]*/, "")
    .replace(
      /\b(tabata|radio edit|original mix|remastered \d+|single version|remix|edit|version)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreFile(fileName, track) {
  const fileNorm = normalize(fileName);
  const titleNorm = normalize(track.title);
  const artistNorm = normalize(track.artist);
  if (!fileNorm || !titleNorm) {
    return 0;
  }
  if (fileNorm === titleNorm || fileNorm.includes(titleNorm) || titleNorm.includes(fileNorm)) {
    return 100;
  }
  const fileTokens = new Set(fileNorm.split(" ").filter(Boolean));
  const titleTokens = titleNorm.split(" ").filter((token) => token.length > 2);
  const artistTokens = artistNorm.split(" ").filter((token) => token.length > 2);
  const titleHits = titleTokens.filter((token) => fileTokens.has(token)).length;
  const artistHits = artistTokens.filter((token) => fileTokens.has(token)).length;
  const titleScore = titleTokens.length ? (titleHits / titleTokens.length) * 80 : 0;
  const artistScore = artistTokens.length ? (artistHits / artistTokens.length) * 20 : 0;
  return titleScore + artistScore;
}

function equalPower(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  return {
    fadingOut: Math.cos((clamped * Math.PI) / 2),
    fadingIn: Math.sin((clamped * Math.PI) / 2),
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function revokeUrl(key) {
  const url = state.objectUrls.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    state.objectUrls.delete(key);
  }
}

function fileUrl(key) {
  const record = state.files.get(key);
  if (!record) {
    return null;
  }
  if (!state.objectUrls.has(key)) {
    state.objectUrls.set(key, URL.createObjectURL(record.blob));
  }
  return state.objectUrls.get(key);
}

function loadedCount(playlist) {
  return playlist.tracks.reduce((count, _track, index) => {
    return count + (state.files.has(trackKey(playlist.id, index)) ? 1 : 0);
  }, 0);
}

function nextLoadedIndex(fromIndex, step) {
  const playlist = currentPlaylist();
  const total = playlist.tracks.length;
  let index = fromIndex;
  for (let i = 0; i < total; i += 1) {
    index += step;
    if (index < 0 || index >= total) {
      return -1;
    }
    if (state.files.has(trackKey(playlist.id, index))) {
      return index;
    }
  }
  return -1;
}

function firstLoadedIndex() {
  return nextLoadedIndex(-1, 1);
}

async function persistFile(key, file) {
  const record = {
    name: file.name,
    type: file.type || "audio/mpeg",
    blob: file,
  };
  state.files.set(key, record);
  revokeUrl(key);
  try {
    await idbPut(key, record);
  } catch (error) {
    console.warn("IndexedDB save failed", error);
  }
}

async function restoreFiles() {
  for (const playlist of window.PLAYLISTS) {
    for (let index = 0; index < playlist.tracks.length; index += 1) {
      const key = trackKey(playlist.id, index);
      try {
        const record = await idbGet(key);
        if (record && record.blob) {
          state.files.set(key, record);
        }
      } catch (error) {
        console.warn("IndexedDB read failed", error);
      }
    }
  }
}

async function unlockAudio() {
  if (state.unlocked) {
    return;
  }
  if ("audioSession" in navigator) {
    try {
      navigator.audioSession.type = "playback";
    } catch (error) {
      // Older iOS builds expose the object but reject this assignment.
    }
  }
  for (const audio of decks) {
    audio.src = SILENT_WAV;
    audio.muted = true;
    audio.volume = 0;
    try {
      await audio.play();
    } catch (error) {
      // First-gesture unlock can still fail if Safari blocked the tap.
    }
    audio.pause();
    audio.muted = false;
    audio.currentTime = 0;
  }
  state.unlocked = true;
}

function stopCrossfade() {
  state.crossfade = null;
}

function activeAudio() {
  return decks[state.activeDeck];
}

function idleAudio() {
  return decks[1 - state.activeDeck];
}

function loadDeck(audio, index) {
  const playlist = currentPlaylist();
  const key = trackKey(playlist.id, index);
  const url = fileUrl(key);
  if (!url) {
    return false;
  }
  if (audio.dataset.key !== key) {
    audio.dataset.key = key;
    audio.src = url;
    audio.load();
  }
  return true;
}

function setDeckVolume(audio, volume) {
  audio.volume = Math.min(1, Math.max(0, volume));
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  const playlist = currentPlaylist();
  const track = playlist.tracks[state.index];
  if (!track) {
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: playlist.name,
  });
  navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
  const audio = activeAudio();
  if (Number.isFinite(audio.duration) && Number.isFinite(audio.currentTime)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: 1,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch (error) {
      // Safari throws if duration is still 0.
    }
  }
}

function bindMediaSession() {
  if (!("mediaSession" in navigator)) {
    return;
  }
  const bind = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      // Unsupported action on this Safari version.
    }
  };
  bind("play", () => playFrom(state.index));
  bind("pause", () => pausePlayback());
  bind("previoustrack", () => skip(-1));
  bind("nexttrack", () => skip(1));
  bind("seekbackward", (event) => seekBy(-(event.seekOffset || 10)));
  bind("seekforward", (event) => seekBy(event.seekOffset || 10));
}

async function playFrom(index, { fadeIn = false } = {}) {
  const playlist = currentPlaylist();
  if (!state.files.has(trackKey(playlist.id, index))) {
    const fallback = nextLoadedIndex(index - 1, 1);
    if (fallback === -1) {
      setToast("Load audio files before playing.");
      return;
    }
    index = fallback;
  }

  await unlockAudio();
  stopCrossfade();
  state.index = index;
  state.playing = true;

  const current = activeAudio();
  const standby = idleAudio();
  if (!loadDeck(current, index)) {
    setToast("That track is missing a file.");
    return;
  }

  current.currentTime = 0;
  setDeckVolume(current, fadeIn ? 0 : 1);
  try {
    await current.play();
  } catch (error) {
    state.playing = false;
    setToast("Safari blocked playback. Tap Play again.");
    return;
  }

  const upcoming = nextLoadedIndex(index, 1);
  if (upcoming !== -1) {
    loadDeck(standby, upcoming);
    standby.pause();
    setDeckVolume(standby, 0);
  }

  updateMediaSession();
  render();
}

function pausePlayback() {
  state.playing = false;
  stopCrossfade();
  decks.forEach((audio) => audio.pause());
  updateMediaSession();
  render();
}

function seekBy(offset) {
  const audio = activeAudio();
  if (!Number.isFinite(audio.duration)) {
    return;
  }
  audio.currentTime = Math.min(
    Math.max(0, audio.currentTime + offset),
    Math.max(0, audio.duration - 0.05),
  );
}

async function skip(step) {
  const target = nextLoadedIndex(state.index, step);
  if (target === -1) {
    if (step > 0) {
      pausePlayback();
      setToast("End of playlist.");
    }
    return;
  }
  if (!state.playing) {
    state.index = target;
    render();
    return;
  }
  await startFadeTo(target, SKIP_FADE_SECONDS);
}

async function startFadeTo(nextIndex, durationSeconds) {
  if (state.crossfade || state.startingFade) {
    return;
  }
  const outgoing = activeAudio();
  const incoming = idleAudio();
  if (!loadDeck(incoming, nextIndex)) {
    return;
  }
  state.startingFade = true;
  incoming.currentTime = 0;
  setDeckVolume(incoming, 0);
  try {
    await incoming.play();
  } catch (error) {
    state.startingFade = false;
    await playFrom(nextIndex);
    return;
  }
  state.crossfade = {
    fromIndex: state.index,
    toIndex: nextIndex,
    outgoing,
    incoming,
    startedAt: performance.now(),
    durationMs: durationSeconds * 1000,
  };
  state.startingFade = false;
}

function finishCrossfade() {
  const fade = state.crossfade;
  if (!fade) {
    return;
  }
  fade.outgoing.pause();
  setDeckVolume(fade.outgoing, 0);
  setDeckVolume(fade.incoming, 1);
  state.activeDeck = 1 - state.activeDeck;
  state.index = fade.toIndex;
  stopCrossfade();

  const upcoming = nextLoadedIndex(state.index, 1);
  if (upcoming !== -1) {
    loadDeck(idleAudio(), upcoming);
    idleAudio().pause();
    setDeckVolume(idleAudio(), 0);
  }
  updateMediaSession();
  render();
}

function maybeStartCrossfade() {
  if (!state.playing || state.crossfade || state.startingFade) {
    return;
  }
  const audio = activeAudio();
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    return;
  }
  const remaining = audio.duration - audio.currentTime;
  const nextIndex = nextLoadedIndex(state.index, 1);
  if (nextIndex === -1) {
    return;
  }
  const fadeSeconds = Math.min(CROSSFADE_SECONDS, Math.max(0.4, audio.duration / 2));
  if (remaining <= fadeSeconds) {
    startFadeTo(nextIndex, fadeSeconds);
  }
}

function tick() {
  const audio = activeAudio();
  if (state.crossfade) {
    const fade = state.crossfade;
    const progress = (performance.now() - fade.startedAt) / fade.durationMs;
    const volumes = equalPower(progress);
    setDeckVolume(fade.outgoing, volumes.fadingOut);
    setDeckVolume(fade.incoming, volumes.fadingIn);
    if (progress >= 1) {
      finishCrossfade();
    }
  } else {
    maybeStartCrossfade();
  }

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const ratio = duration ? Math.min(1, current / duration) : 0;
  els.progressFill.style.width = `${ratio * 100}%`;
  els.elapsed.textContent = formatTime(current);
  els.remaining.textContent = `-${formatTime(Math.max(0, duration - current))}`;
  els.playButton.textContent = state.playing ? "Pause" : "Play";
  els.status.textContent = state.playing ? "Playing in order" : "Ready";
  if (state.playing) {
    updateMediaSession();
  }
  requestAnimationFrame(tick);
}

function matchFiles(fileList, mode) {
  const playlist = currentPlaylist();
  const files = Array.from(fileList).filter((file) => file.type.startsWith("audio") || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name));
  if (!files.length) {
    setToast("No audio files found in that selection.");
    return [];
  }

  const assignments = [];
  if (mode === "order") {
    files.forEach((file, index) => {
      if (index < playlist.tracks.length) {
        assignments.push({ index, file });
      }
    });
    return assignments;
  }

  const usedFiles = new Set();
  const usedSlots = new Set();
  const candidates = [];
  files.forEach((file, fileIndex) => {
    playlist.tracks.forEach((track, index) => {
      const score = scoreFile(file.name, track);
      if (score >= 35) {
        candidates.push({ index, fileIndex, file, score });
      }
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  candidates.forEach((candidate) => {
    if (usedFiles.has(candidate.fileIndex) || usedSlots.has(candidate.index)) {
      return;
    }
    usedFiles.add(candidate.fileIndex);
    usedSlots.add(candidate.index);
    assignments.push({ index: candidate.index, file: candidate.file });
  });

  const leftover = files.filter((_file, fileIndex) => !usedFiles.has(fileIndex));
  leftover.forEach((file) => {
    const emptyIndex = playlist.tracks.findIndex(
      (_track, index) =>
        !usedSlots.has(index) && !state.files.has(trackKey(playlist.id, index)),
    );
    if (emptyIndex !== -1) {
      usedSlots.add(emptyIndex);
      assignments.push({ index: emptyIndex, file });
    }
  });
  return assignments;
}

async function importFiles(fileList, mode) {
  await unlockAudio();
  const assignments = matchFiles(fileList, mode);
  for (const assignment of assignments) {
    await persistFile(trackKey(state.playlistId, assignment.index), assignment.file);
  }
  const playlist = currentPlaylist();
  setToast(`Loaded ${assignments.length} file(s) into ${playlist.name}. ${loadedCount(playlist)}/${playlist.tracks.length} ready.`);
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  render();
}

async function clearCurrentPlaylist() {
  const playlist = currentPlaylist();
  pausePlayback();
  for (let index = 0; index < playlist.tracks.length; index += 1) {
    const key = trackKey(playlist.id, index);
    state.files.delete(key);
    revokeUrl(key);
    try {
      await idbDelete(key);
    } catch (error) {
      console.warn("IndexedDB delete failed", error);
    }
  }
  decks.forEach((audio) => {
    audio.removeAttribute("src");
    delete audio.dataset.key;
  });
  setToast(`Cleared ${playlist.name} audio from this device.`);
  render();
}

function render() {
  const playlist = currentPlaylist();
  document.body.dataset.accent = playlist.accent;
  els.now.className = `now ${playlist.accent}`;
  els.title.textContent = playlist.tracks[state.index]?.title || "No track selected";
  els.artist.textContent = playlist.tracks[state.index]?.artist || "";
  const upcoming = nextLoadedIndex(state.index, 1);
  els.next.textContent =
    upcoming === -1
      ? "Last loaded track"
      : `Next: ${playlist.tracks[upcoming].title}`;
  els.meta.textContent = `${loadedCount(playlist)} / ${playlist.tracks.length} loaded · 9s crossfade · no shuffle`;

  window.PLAYLISTS.forEach((item) => {
    const tab = els.tabs.querySelector(`[data-playlist="${item.id}"]`);
    tab.classList.toggle("active", item.id === playlist.id);
    tab.classList.toggle("mint", item.accent === "mint");
    tab.classList.toggle("orange", item.accent === "orange");
  });

  els.list.replaceChildren();
  playlist.tracks.forEach((track, index) => {
    const key = trackKey(playlist.id, index);
    const loaded = state.files.has(key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track";
    button.classList.toggle("current", index === state.index);
    button.classList.toggle("missing", !loaded);
    button.innerHTML = `
      <span class="num">${String(index + 1).padStart(2, "0")}</span>
      <span>
        <span class="track-title"></span>
        <span class="track-artist"></span>
      </span>
      <span class="badge ${loaded ? "ok" : ""}">${loaded ? "Ready" : "Missing"}</span>
    `;
    button.querySelector(".track-title").textContent = track.title;
    button.querySelector(".track-artist").textContent = loaded
      ? `${track.artist} · ${state.files.get(key).name}`
      : track.artist;
    button.addEventListener("click", () => {
      if (!loaded) {
        setToast("Load a file for that track first.");
        return;
      }
      playFrom(index);
    });
    els.list.appendChild(button);
  });
}

function bindUi() {
  els.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-playlist]");
    if (!tab) {
      return;
    }
    if (tab.dataset.playlist === state.playlistId) {
      return;
    }
    pausePlayback();
    state.playlistId = tab.dataset.playlist;
    state.index = firstLoadedIndex();
    if (state.index < 0) {
      state.index = 0;
    }
    render();
  });

  els.playButton.addEventListener("click", () => {
    if (state.playing) {
      pausePlayback();
      return;
    }
    playFrom(state.index);
  });
  els.prevButton.addEventListener("click", () => skip(-1));
  els.nextButton.addEventListener("click", () => skip(1));
  els.matchInput.addEventListener("change", (event) => {
    importFiles(event.target.files, "match");
    event.target.value = "";
  });
  els.orderInput.addEventListener("change", (event) => {
    importFiles(event.target.files, "order");
    event.target.value = "";
  });
  els.clearButton.addEventListener("click", () => {
    if (window.confirm("Remove loaded audio for this playlist from the phone?")) {
      clearCurrentPlaylist();
    }
  });

  document.addEventListener("visibilitychange", () => {
    // Stay playing when the screen locks or Safari backgrounds the tab.
    if (state.playing && document.visibilityState === "visible") {
      activeAudio().play().catch(() => {});
    }
  });
}

function cacheDom() {
  els.status = document.querySelector("#status");
  els.now = document.querySelector("#now");
  els.title = document.querySelector("#now-title");
  els.artist = document.querySelector("#now-artist");
  els.next = document.querySelector("#next-line");
  els.meta = document.querySelector("#meta-line");
  els.progressFill = document.querySelector("#progress-fill");
  els.elapsed = document.querySelector("#elapsed");
  els.remaining = document.querySelector("#remaining");
  els.playButton = document.querySelector("#play");
  els.prevButton = document.querySelector("#prev");
  els.nextButton = document.querySelector("#next");
  els.tabs = document.querySelector("#tabs");
  els.list = document.querySelector("#track-list");
  els.toast = document.querySelector("#toast");
  els.matchInput = document.querySelector("#file-match");
  els.orderInput = document.querySelector("#file-order");
  els.clearButton = document.querySelector("#clear");
  decks.push(document.querySelector("#deck-a"), document.querySelector("#deck-b"));
}

function setupDecks() {
  decks.forEach((audio) => {
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      if (!state.playing || state.crossfade) {
        return;
      }
      const nextIndex = nextLoadedIndex(state.index, 1);
      if (nextIndex === -1) {
        pausePlayback();
        setToast("End of playlist.");
        return;
      }
      playFrom(nextIndex);
    });
  });
}

async function init() {
  cacheDom();
  setupDecks();
  bindUi();
  bindMediaSession();
  try {
    state.db = await openDb();
    await restoreFiles();
  } catch (error) {
    setToast("This browser would not keep files after reload. Load them once before the event.");
  }
  if (firstLoadedIndex() !== -1) {
    state.index = firstLoadedIndex();
  }
  render();
  requestAnimationFrame(tick);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
