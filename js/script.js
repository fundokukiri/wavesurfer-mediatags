(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  const app = document.querySelector("#app-content");
  if (!app) return;

  const trackArt = app.querySelector(".album-art img");
  const trackName = app.querySelector(".track-name #name");
  const trackArtist = app.querySelector(".track-name #artist");
  const trackAlbum = app.querySelector(".track-name #album");
  const errorBox = app.querySelector("#player-error");
  const bgArtwork = app.querySelector("#bg-artwork");
  const bgLayer = app.querySelector("#bg-layer");
  const seekBar = app.querySelector("#track-seek-bar");
  const playPauseBtn = app.querySelector(".play-pause");
  const playPauseBtnIcon = app.querySelector(".play-pause span");
  const repeatBtn = app.querySelector(".repeat-btn");
  const repeatBtnIcon = app.querySelector(".repeat-btn span");
  const prevBtn = app.querySelector("#prev");
  const shuffleBtn = app.querySelector(".shuffleBtn");
  const shuffleBtnIcon = app.querySelector(".shuffleBtn span");
  const nextBtn = app.querySelector("#next");
  const muteBtn = app.querySelector(".mute-volume");
  const muteBtnIcon = app.querySelector(".mute-volume span");
  const volumeUpBtn = app.querySelector(".volume-up");
  const volumeSlider = app.querySelector("#volume-control-slider");
  const currentTime = app.querySelector("#current-time");
  const remainingTime = app.querySelector("#remaining-time");
  const sidebar = app.querySelector(".sidebar");
  const searchInput = app.querySelector("#playlist-search");
  const favToggle = app.querySelector("#fav-toggle");
  const addTracksBtn = app.querySelector("#add-tracks");
  const folderBtn = app.querySelector("#folder-open");
  const localFilesInput = app.querySelector("#local-files");
  const folderFallback = app.querySelector("#folder-fallback");
  const dropHint = app.querySelector("#drop-hint");
  const restoreBanner = app.querySelector("#folder-restore");
  const restoreName = app.querySelector("#folder-restore-name");
  const folderChip = app.querySelector("#folder-chip");
  const folderChipName = app.querySelector("#folder-chip-name");
  const folderUnlinkBtn = app.querySelector("#folder-unlink");
  const toastEl = document.querySelector("#toast");
  const confirmModal = document.querySelector("#confirm-modal");
  const confirmTitle = document.querySelector("#confirm-title");
  const confirmMessage = document.querySelector("#confirm-message");
  const confirmOk = document.querySelector("#confirm-ok");
  const confirmCancel = document.querySelector("#confirm-cancel");

  // Two-step in-app confirmation — replaces the native confirm() popups.
  const confirmTwice = (title, message, okLabel) =>
    new Promise((resolve) => {
      if (!confirmModal) {
        resolve(false);
        return;
      }
      let step = 0;
      confirmTitle.textContent = title;
      confirmMessage.textContent = message;
      confirmOk.textContent = okLabel;
      confirmModal.hidden = false;

      const close = (result) => {
        confirmModal.hidden = true;
        confirmOk.onclick = null;
        confirmCancel.onclick = null;
        confirmModal.onclick = null;
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === "Escape") close(false);
      };
      document.addEventListener("keydown", onKey);
      confirmModal.onclick = (e) => {
        if (e.target === confirmModal) close(false);
      };
      confirmCancel.onclick = () => close(false);
      confirmOk.onclick = () => {
        step += 1;
        if (step === 1) {
          confirmMessage.textContent = "Are you sure? This cannot be undone.";
          confirmOk.textContent = "Yes, remove";
        } else {
          close(true);
        }
      };
    });

  let toastTimer = null;
  const showToast = (message) => {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2600);
  };

  const searchWrap = app.querySelector("#playlist-search-wrap");
  const searchToggle = app.querySelector("#search-toggle");
  const playlistSubtitle = app.querySelector("#playlist-subtitle");

  const DEFAULT_ARTWORK = "./assets/images/default-icon.jpg";
  const AUDIO_FOLDER = "audio/";
  const SETTINGS_KEY = "musicPlayer.settings";

  const options = {
    container: "#waveform",
    waveColor: "#b5b7b8",
    progressColor: "#000000",
    height: 50,
    barWidth: 2,
    barHeight: 1,
    hideScrollbar: true,
    cursorWidth: 0,
    barRadius: 3,
    minPxPerSec: 100,
    mediaControls: false,
    autoScroll: true,
    autoCenter: true,
    audioRate: 1,
    normalize: false,
  };

  // Cached by track path (not index) so entries stay valid after a shuffle.
  const metaCache = {};

  // Duration per track path, probed lazily via <audio preload="metadata">.
  const durationCache = {};

  // ---------------------------------------------------------------------------
  // Playlist loading. On servers with directory indexes (python3 -m
  // http.server, npx serve, ...) the audio/ listing is scraped directly, so
  // dropped-in files appear with just a refresh. Static hosts without
  // directory indexes (Vercel, GitHub Pages, ...) fall back to the generated
  // audio/playlist.json manifest — regenerate it with
  // `node scripts/generate-playlist.mjs` after adding tracks.
  // ---------------------------------------------------------------------------
  const normalizeFileNames = (fileNames) =>
    [...new Set(fileNames)]
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      )
      .map((name) => ({ name: name.slice(0, -4), path: AUDIO_FOLDER + name }));

  const scanDirectoryListing = async (folderUrl) => {
    const response = await fetch(folderUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    return normalizeFileNames(
      [...doc.querySelectorAll("a[href]")]
        .map((a) => {
          try {
            const href = a.getAttribute("href") || "";
            if (href.startsWith("?")) return null; // sort/query links, not files
            const url = new URL(href, folderUrl);
            return decodeURIComponent(url.pathname.split("/").pop() || "");
          } catch {
            return null;
          }
        })
        .filter((name) => name && name.toLowerCase().endsWith(".mp3"))
    );
  };

  const loadManifest = async () => {
    const manifestUrl = new URL(
      AUDIO_FOLDER + "playlist.json",
      document.baseURI
    ).href;
    const response = await fetch(manifestUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const fileNames = await response.json();
    if (!Array.isArray(fileNames)) throw new Error("Malformed playlist.json");
    return normalizeFileNames(
      fileNames.filter(
        (name) => typeof name === "string" && name.toLowerCase().endsWith(".mp3")
      )
    );
  };

  const loadPlaylist = async () => {
    const folderUrl = new URL(AUDIO_FOLDER, document.baseURI).href;
    let scanFailure = null;
    try {
      const tracks = await scanDirectoryListing(folderUrl);
      if (tracks.length) return tracks;
    } catch (err) {
      scanFailure = err; // no directory index — try the manifest below
    }
    try {
      return await loadManifest();
    } catch {
      // The scrape worked but the folder is genuinely empty: report an empty
      // playlist rather than a manifest error.
      if (!scanFailure) return [];
      throw scanFailure;
    }
  };

  const renderPlaylistStatus = (message) => {
    const tbody = document.querySelector(".tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const status = document.createElement("div");
    status.className = "playlist-status";
    status.textContent = message;
    tbody.append(status);
  };

  const resolveTrackUrl = (track) => new URL(track.path, document.baseURI).href;

  const loadDuration = (track, onDone) => {
    const cached = durationCache[track.path];
    if (cached !== undefined) {
      onDone(cached);
      return;
    }
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      durationCache[track.path] = probe.duration;
      onDone(probe.duration);
      probe.removeAttribute("src");
      probe.load();
    };
    probe.onerror = () => {
      durationCache[track.path] = NaN; // remember the failure, show "--:--"
      onDone(NaN);
    };
    probe.src = resolveTrackUrl(track);
  };

  // ---------------------------------------------------------------------------
  // Settings persistence (localStorage)
  // ---------------------------------------------------------------------------
  const loadSettings = () => {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      return {};
    }
  };

  const saveSettings = (patch) => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...loadSettings(), ...patch })
      );
    } catch {
      // Storage unavailable (private mode) — settings just won't persist.
    }
  };

  const POSITIONS_KEY = "musicPlayer.positions";

  const loadPositions = () => {
    try {
      const map = JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {};
      // Blob URLs die on reload; drop stale or useless entries.
      for (const key of Object.keys(map)) {
        if (key.startsWith("blob:") || typeof map[key] !== "number" || map[key] < 3) {
          delete map[key];
        }
      }
      return map;
    } catch {
      return {};
    }
  };

  const savePositions = (map) => {
    try {
      const keys = Object.keys(map);
      if (keys.length > 50) {
        for (const key of keys.slice(0, keys.length - 50)) delete map[key];
      }
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(map));
    } catch {
      // Storage unavailable — positions just won't persist.
    }
  };

  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;

  // ---------------------------------------------------------------------------
  // IndexedDB — persists local folder handles and individual audio files so
  // user-added music survives page reloads.
  // ---------------------------------------------------------------------------
  const idbOpen = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open("musicPlayer", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("local");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const idbSet = async (key, value) => {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("local", "readwrite");
      tx.objectStore("local").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  };

  const idbGet = async (key) => {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction("local").objectStore("local").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  const idbGetByPrefix = async (prefix) => {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const out = [];
      const req = db.transaction("local").objectStore("local").openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (String(cursor.key).startsWith(prefix)) {
            out.push({ key: cursor.key, value: cursor.value });
          }
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  };

  const idbDel = async (key) => {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("local", "readwrite");
      tx.objectStore("local").delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  };

  const tracksFromFiles = (files) =>
    files.map((file) => ({
      name: file.name.replace(/\.[^.]+$/, ""),
      path: URL.createObjectURL(file),
      file,
      local: true,
      source: "file",
      id: `local:${file.name}:${file.size}`,
    }));

  // Recursively read a picked directory handle (Chromium File System Access).
  const scanDirHandle = async (dirHandle, prefix = "", depth = 0) => {
    const tracks = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && AUDIO_EXT.test(entry.name)) {
        const file = await entry.getFile();
        tracks.push({
          name: file.name.replace(/\.[^.]+$/, ""),
          path: URL.createObjectURL(file),
          file,
          local: true,
          source: "folder",
          id: `local:${prefix}${entry.name}:${file.size}`,
        });
      } else if (entry.kind === "directory" && depth < 2) {
        tracks.push(
          ...(await scanDirHandle(entry, `${prefix}${entry.name}/`, depth + 1))
        );
      }
    }
    return tracks;
  };

  // Recursively collect audio files from a dropped FileSystemEntry (supports
  // dropping whole folders). readEntries returns in ≤100-entry batches.
  const collectDroppedEntry = (entry, out, depth = 0) =>
    new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (file) => {
            if (AUDIO_EXT.test(file.name)) out.push(file);
            resolve();
          },
          () => resolve()
        );
      } else if (entry.isDirectory && depth < 2) {
        const reader = entry.createReader();
        const readBatch = () => {
          reader.readEntries(async (batch) => {
            if (!batch.length) {
              resolve();
              return;
            }
            for (const sub of batch) {
              await collectDroppedEntry(sub, out, depth + 1);
            }
            readBatch();
          }, () => resolve());
        };
        readBatch();
      } else {
        resolve();
      }
    });

  // ---------------------------------------------------------------------------
  // App
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    const settings = loadSettings();

    let allTracks = [];
    try {
      allTracks = await loadPlaylist();
    } catch (err) {
      console.error("Playlist scan failed:", err);
      renderPlaylistStatus(
        "Could not read the audio folder. Serve the app over HTTP with directory listing enabled, or generate audio/playlist.json (node scripts/generate-playlist.mjs) and refresh."
      );
      return;
    }
    if (!allTracks.length) {
      renderPlaylistStatus(`No MP3 files found in "${AUDIO_FOLDER}".`);
      return;
    }

    let index = 0;
    let isRepeat = [0, 1, 2].includes(settings.repeat) ? settings.repeat : 0;
    let isShuffle = Boolean(settings.shuffle);
    let currentVolume =
      typeof settings.volume === "number"
        ? Math.min(Math.max(settings.volume, 0), 1)
        : 1;
    let shuffledArray = allTracks.slice();
    const favoriteKeys = Array.isArray(settings.favorites)
      ? settings.favorites.filter((key) => !key.startsWith("blob:"))
      : [];
    const favorites = new Set(favoriteKeys);
    if (favoriteKeys.length !== (settings.favorites || []).length) {
      saveSettings({ favorites: favoriteKeys });
    }
    let favOnly = Boolean(settings.favOnly);
    const excludedTracks = new Set(
      Array.isArray(settings.excludedTracks) ? settings.excludedTracks : []
    );
    // Tombstones: file keys the user removed — guards against an IDB delete
    // racing a fast reload, which would otherwise bring the track back.
    const removedFileKeys = new Set(
      Array.isArray(settings.removedFileKeys)
        ? settings.removedFileKeys.filter((key) => /^file:.+:\d+$/.test(key))
        : []
    );
    let linkedFolderHandle = null;
    const positions = loadPositions();
    let lastPositionSave = 0;
    let loadedKey = null; // favorites/positions key of the loaded media

    const wavesurfer = WaveSurfer.create(options);

    const MediaMetadata = window.MediaMetadata || function () {};

    const setMediaSessionAction = (action, handler) => {
      if (!navigator.mediaSession || !navigator.mediaSession.setActionHandler)
        return;
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    };

    const showError = (message) => {
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
    };

    const hideError = () => {
      if (!errorBox) return;
      errorBox.hidden = true;
    };

    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
    };

    // "Artist - Title" fallback derived from the file name (" - " separates
    // artist from title; dashes inside the artist name are kept).
    const parseFallbackName = (name) => {
      const separatorIndex = name.indexOf(" - ");
      if (separatorIndex === -1) {
        return { artist: name, title: name, album: name };
      }
      return {
        artist: name.slice(0, separatorIndex).trim(),
        title: name.slice(separatorIndex + 3).trim(),
        album: name.slice(separatorIndex + 3).trim(),
      };
    };

    const pictureToUrl = (picture) => {
      if (!picture || !picture.data || !picture.data.length) return null;
      const bytes = new Uint8Array(picture.data);
      return URL.createObjectURL(
        new Blob([bytes], { type: picture.format || "image/jpeg" })
      );
    };

    const getTrackMeta = (i) => {
      const track = shuffledArray[i];
      if (metaCache[track.path]) return Promise.resolve(metaCache[track.path]);
      return new Promise((resolve) => {
        const fallback = parseFallbackName(track.name);
        jsmediatags.read(track.file || resolveTrackUrl(track), {
          onSuccess: (tag) => {
            const tags = tag.tags || {};
            const meta = {
              title: tags.title || fallback.title,
              artist: tags.artist || fallback.artist,
              album: tags.album || fallback.album,
              artworkUrl: pictureToUrl(tags.picture) || DEFAULT_ARTWORK,
            };
            metaCache[track.path] = meta;
            resolve(meta);
          },
          onError: () => {
            const meta = {
              title: fallback.title,
              artist: fallback.artist,
              album: fallback.album,
              artworkUrl: DEFAULT_ARTWORK,
            };
            metaCache[track.path] = meta;
            resolve(meta);
          },
        });
      });
    };

    const applyTrackMetadata = (i) => {
      getTrackMeta(i).then((meta) => {
        trackArt.src = meta.artworkUrl;
        bgArtwork.style.backgroundImage = `url('${meta.artworkUrl}')`;
        trackName.textContent = meta.title;
        trackArtist.textContent = meta.artist;
        trackAlbum.textContent = meta.album;
        document.title = `${meta.title} | ${meta.artist}`;
        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
          });
        }
      });
    };

    // ---------------------------------------------------------------------------
    // Restore saved settings
    // ---------------------------------------------------------------------------
    const shuffleArray = (array) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };

    if (isShuffle) shuffledArray = shuffleArray(allTracks.slice());
    if (typeof settings.lastTrack === "string") {
      const savedIndex = shuffledArray.findIndex(
        (track) => track.name === settings.lastTrack
      );
      if (savedIndex !== -1) index = savedIndex;
    }

    const applyRepeatUi = () => {
      repeatBtnIcon.textContent = isRepeat === 2 ? "repeat_one" : "repeat";
      repeatBtnIcon.style.color = isRepeat === 0 ? "#4d4d4d" : "#4676f9";
    };

    applyRepeatUi();
    shuffleBtnIcon.style.color = isShuffle ? "#4676f9" : "#4d4d4d";
    favToggle?.classList.toggle("fav-active", favOnly);

    // ---------------------------------------------------------------------------
    // Playback helpers
    // ---------------------------------------------------------------------------
    const updatePositionState = () => {
      if (
        !("mediaSession" in navigator) ||
        !navigator.mediaSession.setPositionState
      )
        return;
      const duration = wavesurfer.getDuration();
      if (!duration) return;
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: wavesurfer.getPlaybackRate(),
          position: Math.min(wavesurfer.getCurrentTime(), duration),
        });
      } catch {
        // Invalid position state — ignore.
      }
    };

    const applyVolume = (volume) => {
      wavesurfer.setVolume(volume);
      volumeSlider.value = Math.round(volume * 100);
      muteBtnIcon.textContent = volume === 0 ? "no_sound" : "volume_down";
      currentVolume = volume;
      saveSettings({ volume });
    };

    const toggleMute = () => {
      if (wavesurfer.getVolume() > 0) {
        currentVolume = wavesurfer.getVolume(); // remember pre-mute level
        applyVolume(0);
      } else {
        applyVolume(currentVolume === 0 ? 0.3 : currentVolume);
      }
    };

    const seekBy = (seconds) => {
      const duration = wavesurfer.getDuration();
      if (!duration) return;
      const target = Math.min(
        Math.max(wavesurfer.getCurrentTime() + seconds, 0),
        duration
      );
      wavesurfer.setTime(target);
      updatePositionState();
    };

    const loadTrack = (i) => {
      index = i;
      wavesurfer.load(resolveTrackUrl(shuffledArray[index]));
      highlightPlaylist(index);
    };

    const goToNextTrack = () => loadTrack((index + 1) % shuffledArray.length);
    const goToPrevTrack = () =>
      loadTrack((index - 1 + shuffledArray.length) % shuffledArray.length);

    // ---------------------------------------------------------------------------
    // Audio events
    // ---------------------------------------------------------------------------
    wavesurfer.load(resolveTrackUrl(shuffledArray[index]));
    applyVolume(currentVolume);

    wavesurfer.on("pause", () => {
      playPauseBtnIcon.textContent = "play_arrow";
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
      updatePositionState();
      // Key by loadedKey: when switching tracks, load() pauses the OLD media
      // while index already points at the new one.
      if (loadedKey && !loadedKey.startsWith("blob:") && wavesurfer.getDuration()) {
        positions[loadedKey] = wavesurfer.getCurrentTime();
        savePositions(positions);
      }
      document
        .querySelector(".tbody-playlist.active")
        ?.classList.remove("playing");
    });

    wavesurfer.on("play", () => {
      playPauseBtnIcon.textContent = "pause";
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
      updatePositionState();
      document
        .querySelector(".tbody-playlist.active")
        ?.classList.add("playing");
    });

    playPauseBtn.onclick = () => wavesurfer.playPause();

    wavesurfer.on("ready", () => {
      hideError();
      applyTrackMetadata(index);
      currentTime.textContent = formatTime(0);
      remainingTime.textContent = `-${formatTime(wavesurfer.getDuration())}`;
      seekBar.max = Math.floor(wavesurfer.getDuration());
      // Resume where the track was last left off.
      const currentTrack = shuffledArray[index];
      const currentKey = currentTrack.id || currentTrack.path;
      const savedPosition = positions[currentKey];
      if (savedPosition > 5 && wavesurfer.getDuration() - savedPosition > 10) {
        wavesurfer.setTime(savedPosition);
      }
      wavesurfer.play();
      highlightPlaylist(index);
      if (!currentTrack.local) {
        saveSettings({ lastTrack: currentTrack.name });
      }
      updatePositionState();
      loadedKey = currentKey;
    });

    // "timeupdate" fires while playing and after seeks (even when paused).
    wavesurfer.on("timeupdate", () => {
      const current = wavesurfer.getCurrentTime();
      seekBar.value = Math.floor(current);
      currentTime.textContent = formatTime(current);
      remainingTime.textContent = `-${formatTime(
        wavesurfer.getDuration() - current
      )}`;
      // Local files have blob: paths that die on reload — skip them.
      if (loadedKey && !loadedKey.startsWith("blob:")) {
        const now = Date.now();
        if (now - lastPositionSave > 3000) {
          lastPositionSave = now;
          positions[loadedKey] = current;
          savePositions(positions);
        }
      }
    });

    seekBar.addEventListener("input", () => {
      const duration = wavesurfer.getDuration();
      if (duration > 0) {
        wavesurfer.seekTo(seekBar.value / duration);
        updatePositionState();
      }
    });

    wavesurfer.on("error", (e) => {
      const message = e && e.message ? e.message : String(e);
      showError(`Failed to load audio: ${message}`);
      console.error("WaveSurfer error:", e);
    });

    // ---------------------------------------------------------------------------
    // Controls
    // ---------------------------------------------------------------------------
    repeatBtn.onclick = () => {
      isRepeat = (isRepeat + 1) % 3;
      applyRepeatUi();
      saveSettings({ repeat: isRepeat });
    };

    nextBtn.onclick = goToNextTrack;
    prevBtn.onclick = goToPrevTrack;

    setMediaSessionAction("previoustrack", goToPrevTrack);
    setMediaSessionAction("nexttrack", goToNextTrack);
    setMediaSessionAction("play", () => wavesurfer.play());
    setMediaSessionAction("pause", () => wavesurfer.pause());
    setMediaSessionAction("seekbackward", (details) =>
      seekBy(-(details.seekOffset || 5))
    );
    setMediaSessionAction("seekforward", (details) =>
      seekBy(details.seekOffset || 5)
    );
    setMediaSessionAction("seekto", (details) => {
      if (typeof details.seekTime === "number" && Number.isFinite(details.seekTime)) {
        wavesurfer.setTime(details.seekTime);
        updatePositionState();
      }
    });

    wavesurfer.on("finish", () => {
      if (isRepeat === 1) {
        goToNextTrack();
      } else if (isRepeat === 2) {
        wavesurfer.seekTo(0);
        wavesurfer.play();
      } else {
        const next = (index + 1) % shuffledArray.length;
        loadTrack(next);
        if (next === 0) {
          // End of playlist: load the first track but stay paused.
          wavesurfer.once("ready", () => {
            wavesurfer.pause();
            currentTime.textContent = formatTime(0);
            remainingTime.textContent = `-${formatTime(
              wavesurfer.getDuration()
            )}`;
          });
        }
      }
    });

    muteBtn.onclick = toggleMute;

    volumeUpBtn.onclick = () => applyVolume(1);

    volumeSlider.addEventListener("input", () =>
      applyVolume(Number(volumeSlider.value) / 100)
    );

    trackArt.onclick = () => sidebar.classList.toggle("active");
    app.querySelector(".sidebar .sidebar-overlay").onclick = () =>
      sidebar.classList.remove("active");
    bgLayer.onclick = () => sidebar.classList.remove("active");

    searchToggle.onclick = () => {
      if (!searchWrap) return;
      const isOpen = searchWrap.classList.toggle("open");
      searchToggle.classList.toggle("active", isOpen);
      if (isOpen) {
        searchInput?.focus();
      } else if (searchInput) {
        searchInput.value = "";
        applySearchFilter();
      }
    };

    favToggle.onclick = () => {
      favOnly = !favOnly;
      favToggle.classList.toggle("fav-active", favOnly);
      saveSettings({ favOnly });
      renderPlaylist();
    };

    addTracksBtn.addEventListener("click", () => {
      // A long-press just cleared the category — swallow that click.
      if (addTracksBtn.__longFired) {
        addTracksBtn.__longFired = false;
        return;
      }
      localFilesInput.click();
    });
    localFilesInput.onchange = () => {
      addLocalFiles(localFilesInput.files);
      localFilesInput.value = "";
    };

    // Add a whole music folder. Chromium uses the File System Access API so
    // the handle can be persisted and rescanned after reloads; other browsers
    // fall back to a webkitdirectory input (session-only).
    folderBtn.addEventListener("click", async () => {
      // A long-press just cleared the category — swallow that click.
      if (folderBtn.__longFired) {
        folderBtn.__longFired = false;
        return;
      }
      if (typeof window.showDirectoryPicker === "function") {
        try {
          const handle = await window.showDirectoryPicker({ mode: "read" });
          await idbSet("dirHandle", handle).catch(() => {});
          const tracks = (await scanDirHandle(handle)).filter(
            (t) => !excludedTracks.has(t.id)
          );
          addTracks(tracks);
          showFolderChip(handle);
          if (restoreBanner) restoreBanner.hidden = true;
        } catch {
          // User cancelled the picker.
        }
      } else {
        folderFallback.click();
      }
    });

    folderFallback.onchange = () => {
      const files = [...folderFallback.files].filter((file) =>
        AUDIO_EXT.test(file.name)
      );
      addTracks(
        files.map((file) => ({
          name: file.name.replace(/\.[^.]+$/, ""),
          path: URL.createObjectURL(file),
          file,
          local: true,
          id: `local:${file.webkitRelativePath || file.name}:${file.size}`,
        }))
      );
      folderFallback.value = "";
    };

    // Drag & drop audio files or whole folders anywhere onto the player.
    let dragDepth = 0;
    window.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (++dragDepth === 1 && dropHint) dropHint.hidden = false;
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("dragleave", () => {
      if (--dragDepth <= 0) {
        dragDepth = 0;
        if (dropHint) dropHint.hidden = true;
      }
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      if (dropHint) dropHint.hidden = true;
      const entries = [...(e.dataTransfer?.items || [])]
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);
      if (entries.length) {
        (async () => {
          const files = [];
          for (const entry of entries) {
            await collectDroppedEntry(entry, files);
          }
          // Persisting a huge dropped folder could bloat IndexedDB — only
          // small drops are kept for the next session.
          if (files.length && files.length <= 20) {
            files.forEach((file) => {
              idbSet(`file:${file.name}:${file.size}`, file).catch(() => {});
            });
          }
          addTracks(tracksFromFiles(files));
        })();
      } else if (e.dataTransfer?.files?.length) {
        addLocalFiles(e.dataTransfer.files);
      }
    });

    shuffleBtn.onclick = () => {
      isShuffle = !isShuffle;
      shuffleBtnIcon.style.color = isShuffle ? "#4676f9" : "#4d4d4d";
      const currentName = shuffledArray[index].name;
      shuffledArray = isShuffle
        ? shuffleArray(shuffledArray.slice())
        : allTracks.slice();
      index = shuffledArray.findIndex((track) => track.name === currentName);
      saveSettings({ shuffle: isShuffle });
      renderPlaylist();
      highlightPlaylist(index);
    };

    // Keyboard shortcuts (skipped while typing in an input or with modifiers).
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.matches("input, textarea, select")
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          wavesurfer.playPause();
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(5);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-5);
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume(Math.min(wavesurfer.getVolume() + 0.1, 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume(Math.max(wavesurfer.getVolume() - 0.1, 0));
          break;
        case "KeyN":
          goToNextTrack();
          break;
        case "KeyP":
          goToPrevTrack();
          break;
        case "KeyM":
          toggleMute();
          break;
      }
    });

    // ---------------------------------------------------------------------------
    // Playlist
    // ---------------------------------------------------------------------------
    const highlightPlaylist = (i) => {
      document.querySelectorAll(".tbody-playlist").forEach((el, idx) => {
        el.classList.toggle("active", idx === i);
        if (idx === i) el.scrollIntoView({ block: "nearest" });
      });
    };

    const applySearchFilter = () => {
      const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
      document.querySelectorAll(".tbody-playlist").forEach((row) => {
        const track = shuffledArray[Number(row.dataset.index)];
        const info = row.querySelector(".tp-info");
        const matchesQuery =
          query === "" ||
          (info?.textContent || "").toLowerCase().includes(query);
        const matchesFavorites = !favOnly || favorites.has(track?.id || track?.path);
        row.hidden = !matchesQuery || !matchesFavorites;
      });
    };
    searchInput?.addEventListener("input", applySearchFilter);

    const formatTotalTime = (totalSeconds) => {
      const minutes = Math.round(totalSeconds / 60);
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const parts = [];
      if (hours) parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
      if (mins || !hours) parts.push(`${mins} minute${mins === 1 ? "" : "s"}`);
      return parts.join(" ");
    };

    const updatePlaylistSubtitle = () => {
      if (!playlistSubtitle) return;
      const visible = shuffledArray.filter(
        (track) => !favOnly || favorites.has(track.id || track.path)
      );
      const totalSeconds = visible.reduce((sum, track) => {
        const duration = durationCache[track.path];
        return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
      }, 0);
      playlistSubtitle.textContent = `${visible.length} ${
        visible.length === 1 ? "song" : "songs"
      } · ${formatTotalTime(totalSeconds)}`;
    };

    const renderPlaylist = () => {
      const tbody = document.querySelector(".tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      updatePlaylistSubtitle();
      shuffledArray.forEach((item, i) => {
        const fallback = parseFallbackName(item.name);

        const row = document.createElement("div");
        row.className = "tbody-playlist";
        row.dataset.index = i;
        row.dataset.trackId = item.id || item.path;

        const number = document.createElement("span");
        number.className = "tp-number";
        number.textContent = i + 1;

        const imgWrap = document.createElement("div");
        imgWrap.className = "tp-img";
        const img = document.createElement("img");
        img.src = DEFAULT_ARTWORK;
        img.alt = "";
        const indicator = document.createElement("div");
        indicator.className = "playing-indicator";
        const eq = document.createElement("span");
        eq.className = "eq";
        for (let bar = 0; bar < 3; bar++) eq.append(document.createElement("i"));
        const indicatorPlay = document.createElement("span");
        indicatorPlay.className = "material-symbols-rounded indicator-play";
        indicatorPlay.textContent = "play_arrow";
        indicator.append(eq, indicatorPlay);
        imgWrap.append(img, indicator);

        const info = document.createElement("div");
        info.className = "tp-info";
        const titleEl = document.createElement("div");
        titleEl.className = "tp-title";
        titleEl.textContent = fallback.title;
        const artistEl = document.createElement("div");
        artistEl.className = "tp-artist";
        artistEl.textContent = fallback.artist;
        info.append(titleEl, artistEl);

        const duration = document.createElement("span");
        duration.className = "tp-duration";
        duration.textContent = "--:--";

        const heart = document.createElement("button");
        heart.type = "button";
        heart.className = "p-heart";
        heart.setAttribute("aria-label", "Toggle favorite");
        const heartIcon = document.createElement("span");
        heartIcon.className = "material-symbols-rounded";
        heartIcon.textContent = "favorite";
        heart.append(heartIcon);
        const favKey = item.id || item.path;
        if (favorites.has(favKey)) heart.classList.add("fav");
        heart.onclick = (e) => {
          e.stopPropagation();
          if (favorites.has(favKey)) {
            favorites.delete(favKey);
            heart.classList.remove("fav");
          } else {
            favorites.add(favKey);
            heart.classList.add("fav");
          }
          saveSettings({ favorites: [...favorites] });
          applySearchFilter();
          updatePlaylistSubtitle();
        };

        row.append(number, imgWrap, info, duration, heart);

        // Only user-added tracks can be removed — scanned audio/ tracks stay.
        if (item.local) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "p-remove";
          removeBtn.setAttribute("aria-label", "Remove from playlist");
          const removeIcon = document.createElement("span");
          removeIcon.className = "material-symbols-rounded";
          removeIcon.textContent = "close";
          removeBtn.append(removeIcon);
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            if (item.source === "file") {
              // Tombstone first (synchronous localStorage write), then delete
              // from IndexedDB — a fast reload can no longer resurrect it.
              const key = `file:${(item.id || "").slice("local:".length)}`;
              if (/^file:.+:\d+$/.test(key)) {
                removedFileKeys.add(key);
                saveSettings({ removedFileKeys: [...removedFileKeys] });
                idbDel(key).catch(() => {});
              }
            } else if (item.source === "folder") {
              // Keep it out of future rescans of the linked folder.
              excludedTracks.add(favKey);
              saveSettings({ excludedTracks: [...excludedTracks] });
            }
            removeTracks([item]);
          };
          row.append(removeBtn);
        }

        tbody.append(row);

        getTrackMeta(i).then((meta) => {
          if (!row.isConnected) return; // Playlist was re-rendered meanwhile.
          img.src = meta.artworkUrl;
          titleEl.textContent = meta.title;
          artistEl.textContent = meta.artist;
          albumEl.textContent = meta.album;
          applySearchFilter();
        });

        loadDuration(item, (seconds) => {
          updatePlaylistSubtitle();
          if (!row.isConnected) return;
          duration.textContent =
            Number.isFinite(seconds) && seconds > 0 ? formatTime(seconds) : "--:--";
        });
      });
      applySearchFilter();
    };

    // Append tracks to the playlist, skipping ones already present.
    const addTracks = (tracks) => {
      const existing = new Set(allTracks.map((t) => t.id || t.path));
      const fresh = tracks.filter((t) => !existing.has(t.id || t.path));
      if (!fresh.length) return;
      allTracks.push(...fresh);
      shuffledArray.push(...fresh);
      renderPlaylist();
    };

    // Add files picked or dropped by the user and keep them in IndexedDB.
    const addLocalFiles = (fileList) => {
      const audioFiles = [...fileList].filter(
        (file) => file.type.startsWith("audio/") || AUDIO_EXT.test(file.name)
      );
      if (!audioFiles.length) return;
      audioFiles.forEach((file) => {
        const key = `file:${file.name}:${file.size}`;
        // Re-adding a previously removed file lifts its tombstone.
        if (removedFileKeys.delete(key)) {
          saveSettings({ removedFileKeys: [...removedFileKeys] });
        }
        idbSet(key, file).catch(() => {});
      });
      addTracks(tracksFromFiles(audioFiles));
    };

    const removeFileIdbEntries = (tracks) => {
      tracks.forEach((t) => {
        const key = `file:${(t.id || "").slice("local:".length)}`;
        if (!/^file:.+:\d+$/.test(key)) return;
        removedFileKeys.add(key);
        idbDel(key).catch(() => {});
      });
      saveSettings({ removedFileKeys: [...removedFileKeys] });
    };

    // Long-press (hold ~0.7s) a topbar button to bulk-clear its category.
    const clearFileTracksFlow = async () => {
      const fileTracks = allTracks.filter((t) => t.source === "file");
      if (!fileTracks.length) {
        showToast("No songs added from files");
        return;
      }
      const ok = await confirmTwice(
        "Remove added songs?",
        `This will remove ${fileTracks.length} songs added from files.`,
        "Continue"
      );
      if (!ok) return;
      removeFileIdbEntries(fileTracks);
      removeTracks(fileTracks);
      showToast(`Removed ${fileTracks.length} songs`);
    };

    const clearFolderTracksFlow = async () => {
      const folderTracks = allTracks.filter((t) => t.source === "folder");
      if (!folderTracks.length) {
        showToast("No songs added from a folder");
        return;
      }
      const ok = await confirmTwice(
        "Remove folder songs?",
        `This will remove ${folderTracks.length} songs from the linked folder. The folder stays linked.`,
        "Continue"
      );
      if (!ok) return;
      // The folder stays linked — exclusions keep these songs out of rescans.
      folderTracks.forEach((t) => excludedTracks.add(t.id));
      saveSettings({ excludedTracks: [...excludedTracks] });
      removeTracks(folderTracks);
      showToast(`Removed ${folderTracks.length} songs`);
    };

    // Hold a topbar button ~0.7s to trigger its bulk-clear flow. A normal
    // click still runs the button's own action (the flag swallows the click
    // that follows a long-press).
    const attachLongPress = (btn, onLongPress) => {
      let timer = null;
      btn.addEventListener("pointerdown", () => {
        timer = setTimeout(() => {
          timer = null;
          btn.__longFired = true;
          onLongPress();
        }, 700);
      });
      const cancel = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };
      btn.addEventListener("pointerup", cancel);
      btn.addEventListener("pointerleave", cancel);
      btn.addEventListener("pointercancel", cancel);
      // Long-pressing on touch devices must not open the browser menu.
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    };

    attachLongPress(addTracksBtn, clearFileTracksFlow);
    attachLongPress(folderBtn, clearFolderTracksFlow);

    // Remove tracks (and their favorite/position data) from the playlist.
    const removeTracks = (targets) => {
      if (!targets.length) return;
      const keys = new Set(targets.map((t) => t.id || t.path));
      const wasPlaying = keys.has(loadedKey);
      targets.forEach((t) => URL.revokeObjectURL(t.path));
      allTracks = allTracks.filter((t) => !keys.has(t.id || t.path));
      shuffledArray = shuffledArray.filter((t) => !keys.has(t.id || t.path));
      targets.forEach((t) => {
        const key = t.id || t.path;
        if (favorites.delete(key)) saveSettings({ favorites: [...favorites] });
        if (positions[key] !== undefined) {
          delete positions[key];
          savePositions(positions);
        }
      });
      if (!shuffledArray.length) {
        wavesurfer.stop();
        loadedKey = null;
        index = 0;
        renderPlaylist();
        updatePlaylistSubtitle();
        return;
      }
      index = Math.min(index, shuffledArray.length - 1);
      renderPlaylist();
      updatePlaylistSubtitle();
      if (wasPlaying) {
        loadTrack(index);
      } else {
        highlightPlaylist(index);
      }
    };

    const showFolderChip = (handle) => {
      linkedFolderHandle = handle;
      if (folderChipName) folderChipName.textContent = handle.name;
      if (folderChip) folderChip.hidden = false;
    };

    // Unlink the connected folder: drop the handle, remove all of its tracks
    // and clear per-track exclusions (they only mattered for that folder).
    folderUnlinkBtn.onclick = async () => {
      if (!linkedFolderHandle) return;
      await idbDel("dirHandle").catch(() => {});
      saveSettings({ excludedTracks: [] });
      excludedTracks.clear();
      removeTracks(allTracks.filter((t) => t.source === "folder"));
      if (folderChip) folderChip.hidden = true;
      linkedFolderHandle = null;
    };

    // Bound once here — renderPlaylist() re-runs on every shuffle toggle.
    const tbody = document.querySelector(".tbody");
    tbody?.addEventListener("click", (e) => {
      const item = e.target.closest(".tbody-playlist");
      if (!item) return;
      const idx = Number(item.dataset.index);
      if (idx === index) {
        if (wavesurfer.isPlaying()) wavesurfer.pause();
        else wavesurfer.play();
      } else {
        loadTrack(idx);
        sidebar.classList.remove("active");
      }
    });

    renderPlaylist();

    // Restore user-added local music from a previous session.
    (async () => {
      try {
        const stored = (await idbGetByPrefix("file:")).filter(
          (entry) => !removedFileKeys.has(String(entry.key))
        );
        addTracks(tracksFromFiles(stored.map((entry) => entry.value)));
        const handle = await idbGet("dirHandle");
        if (handle) {
          const permission = await handle.queryPermission({ mode: "read" });
          if (permission === "granted") {
            const tracks = (await scanDirHandle(handle)).filter(
              (t) => !excludedTracks.has(t.id)
            );
            addTracks(tracks);
            showFolderChip(handle);
          } else if (restoreBanner) {
            restoreName.textContent = handle.name;
            restoreBanner.hidden = false;
            restoreBanner.onclick = async () => {
              if (
                (await handle.requestPermission({ mode: "read" })) === "granted"
              ) {
                restoreBanner.hidden = true;
                addTracks(await scanDirHandle(handle));
              }
            };
          }
        }
      } catch {
        // IndexedDB unavailable — local music stays session-only.
      }
    })();

    // Persist the current track position when the page is being closed.
    window.addEventListener("beforeunload", () => {
      if (loadedKey && !loadedKey.startsWith("blob:") && wavesurfer.getDuration()) {
        positions[loadedKey] = wavesurfer.getCurrentTime();
        savePositions(positions);
      }
    });
  });
})();
