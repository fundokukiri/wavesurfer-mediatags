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
  // Per-folder chips are built at runtime inside this container — the HTML
  // ships it empty and script fills it with one chip per linked folder.
  const folderChipList = app.querySelector("#folder-chip-list");
  const toastEl = document.querySelector("#toast");
  const confirmModal = document.querySelector("#confirm-modal");
  const confirmTitle = document.querySelector("#confirm-title");
  const confirmMessage = document.querySelector("#confirm-message");
  const confirmOk = document.querySelector("#confirm-ok");
  const confirmCancel = document.querySelector("#confirm-cancel");
  const filesChip = document.querySelector("#files-chip");
  const filesChipName = document.querySelector("#files-chip-name");
  const filesUnlinkBtn = document.querySelector("#files-unlink");

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
          // Keep the caller's wording — the action is not always a removal.
          confirmMessage.textContent = `${message} Are you sure?`;
          confirmOk.textContent = okLabel;
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
  const IS_FIREFOX = /firefox/i.test(navigator.userAgent);
  // iOS/iPadOS (iPads report a Mac UA but keep touch points) ignore
  // audio.volume — loudness is hardware-controlled there.
  const IS_IOS =
    /iP(hone|oad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
    // 100px/s on every device: below ~50 the canvas creeps under a pixel per
    // frame and the browser rounds that into visible judder. Touch devices pay
    // for it with a 22,000px canvas at 2-3x DPR — measured at 60fps.
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
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;

  const normalizeFileNames = (fileNames) =>
    [...new Set(fileNames)]
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      )
      .map((name) => ({ name: name.replace(/\.[^.]+$/, ""), path: AUDIO_FOLDER + name }));

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
        .filter((name) => name && AUDIO_EXT.test(name))
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
        (name) => typeof name === "string" && AUDIO_EXT.test(name)
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

  // One probe element and a queue: a folder of 300 songs used to create 300
  // media elements at once, which mobile Safari will not load.
  const durationQueue = [];
  const probe = new Audio();
  probe.preload = "metadata";
  let probing = false;
  const runProbe = () => {
    if (probing) return;
    const job = durationQueue.shift();
    if (!job) return;
    probing = true;
    const finish = (seconds) => {
      durationCache[job.track.path] = seconds;
      job.onDone(seconds);
      probe.removeAttribute("src");
      probe.load();
      probing = false;
      runProbe();
    };
    probe.onloadedmetadata = () => finish(probe.duration);
    probe.onerror = () => finish(NaN); // remember the failure, show "--:--"
    probe.src = job.url;
  };

  const loadDuration = (track, onDone) => {
    const cached = durationCache[track.path];
    if (cached !== undefined) {
      onDone(cached);
      return;
    }
    durationQueue.push({ track, onDone, url: resolveTrackUrl(track) });
    runProbe();
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

  // Only ONE resume point is kept: the track that was playing and how far it
  // got. It exists so a reload continues where you left off — it is never
  // applied when you deliberately switch to another track.
  const POSITION_KEY = "musicPlayer.position";

  const loadPosition = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY));
      if (
        !saved ||
        typeof saved !== "object" ||
        typeof saved.key !== "string" ||
        typeof saved.time !== "number" ||
        !(saved.time > 5) ||
        saved.key.startsWith("blob:")
      ) {
        return null;
      }
      return saved;
    } catch {
      return null;
    }
  };

  const savePosition = (key, time) => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify({ key, time }));
    } catch {
      // Storage unavailable — the resume point just won't persist.
    }
  };

  // ---------------------------------------------------------------------------
  // IndexedDB — persists local folder handles and individual audio files so
  // user-added music survives page reloads.
  // ---------------------------------------------------------------------------
  // One shared connection instead of a fresh open per operation (a big
  // folder pick used to open one connection PER FILE).
  let idbDbPromise = null;
  const idbOpen = () =>
    (idbDbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("musicPlayer", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("local");
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          idbDbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          idbDbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    }));

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

  // Folder identity for fallback (webkitdirectory) picks: the first segment
  // of the file's relative path — the picked folder's top-level name. Picks
  // without relative paths (programmatic/test input) degrade to the bare
  // file name, which is still stable across reloads.
  const folderIdFromRelPath = (relPath) => (relPath || "").split("/")[0];

  // Folder identity of a persisted fallback file ("dirfile:<path>:<size>").
  // The size suffix lives at the END of the key, so it is stripped before
  // the top-level segment is taken (matters when the path has no folders).
  const folderIdFromDirFileKey = (key) =>
    folderIdFromRelPath(
      String(key).slice("dirfile:".length).replace(/:\d+$/, "")
    );

  // Track id for handle-scanned folder files. The folder name leads the id
  // so identical subpaths+sizes in two different folders never collide —
  // removeTracks keys on ids, and a collision would delete two folders'
  // tracks together. (Pre-multi-folder favorites keyed on the old id
  // format simply won't match anymore.)
  const buildFolderTrackId = (folderId, prefix, name, size) =>
    `local:${folderId}/${prefix}${name}:${size}`;

  // Does a track id belong to a folder? Handle-scanned ids lead with the
  // folder name ("local:<folder>/..."); fallback ids carry it as the first
  // relative-path segment, or as "<folder>:<size>" for picks without
  // relative paths. Lets unlinking lift exactly one folder's exclusions.
  const folderOwnsTrackId = (folderId, trackId) => {
    if (typeof trackId !== "string" || !trackId.startsWith("local:"))
      return false;
    const rest = trackId.slice("local:".length);
    return rest.startsWith(`${folderId}/`) || rest.startsWith(`${folderId}:`);
  };

  // Files persisted by the webkitdirectory fallback — keyed by their path
  // inside the picked folder ("dirfile:<relativePath>:<size>").
  const tracksFromDirFileEntries = (entries) =>
    entries.map(({ key, value: file }) => {
      const relPath = String(key).slice("dirfile:".length);
      return {
        name: relPath.split("/").pop().replace(/\.[^.]+$/, ""),
        path: URL.createObjectURL(file),
        file,
        local: true,
        source: "folder",
        folderId: folderIdFromDirFileKey(key),
        id: `local:${relPath}`,
      };
    });

  // Recursively read a picked directory handle (Chromium File System
  // Access). The ROOT handle's name is threaded through the recursion: it
  // tags every track with its folderId and leads its id (see
  // buildFolderTrackId) — subdirectory names must not hijack the identity.
  const scanDirHandle = async (
    dirHandle,
    prefix = "",
    depth = 0,
    folderId = dirHandle.name
  ) => {
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
          folderId,
          id: buildFolderTrackId(folderId, prefix, entry.name, file.size),
        });
      } else if (entry.kind === "directory" && depth < 8) {
        tracks.push(
          ...(await scanDirHandle(
            entry,
            `${prefix}${entry.name}/`,
            depth + 1,
            folderId
          ))
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
      } else if (entry.isDirectory && depth < 8) {
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
    // Shown after the first render: an empty server playlist must not stop
    // startup, or saved local music would never be restored.
    let emptyMessage = null;
    try {
      allTracks = await loadPlaylist();
    } catch (err) {
      console.error("Playlist scan failed:", err);
      emptyMessage =
        "Could not read the audio folder. Serve the app over HTTP with directory listing enabled, or generate audio/playlist.json (node scripts/generate-playlist.mjs) and refresh.";
    }
    if (!allTracks.length && !emptyMessage) {
      emptyMessage = `No MP3 files found in "${AUDIO_FOLDER}".`;
    }

    let index = 0;
    let isRepeat = [0, 1, 2].includes(settings.repeat) ? settings.repeat : 0;
    let isShuffle = Boolean(settings.shuffle);
    let currentVolume =
      typeof settings.volume === "number"
        ? Math.min(Math.max(settings.volume, 0), 1)
        : 1;
    // Mute is tracked here because media.load() resets the element's
    // mutedness on EVERY track change (HTML spec: it re-reads the muted
    // content attribute, which we never set) — the element flag alone lies.
    let mutedState = Boolean(settings.muted);
    let shuffledArray = allTracks.slice();
    const favoriteKeys = Array.isArray(settings.favorites)
      ? settings.favorites.filter((key) => !key.startsWith("blob:"))
      : [];
    const favorites = new Set(favoriteKeys);
    if (favoriteKeys.length !== (settings.favorites || []).length) {
      saveSettings({ favorites: favoriteKeys });
    }
    // Session-only — reload always returns to the full playlist.
    let favOnly = false;
    // Session-only too: the folder chip being filtered, or null for all.
    let folderFilter = null;
    const excludedTracks = new Set(
      Array.isArray(settings.excludedTracks) ? settings.excludedTracks : []
    );
    // Re-adding a linked folder starts fresh: lift exactly its exclusions so
    // the songs a bulk clear hid come back (README behaviour).
    const liftFolderExclusions = (folderId) => {
      excludedTracks.forEach((id) => {
        if (folderOwnsTrackId(folderId, id)) excludedTracks.delete(id);
      });
    };
    // Tombstones: file keys the user removed — guards against an IDB delete
    // racing a fast reload, which would otherwise bring the track back.
    const removedFileKeys = new Set(
      Array.isArray(settings.removedFileKeys)
        ? settings.removedFileKeys.filter((key) =>
            /^(?:dir)?file:.+:\d+$/.test(key)
          )
        : []
    );
    // Resume point restored from the last session, consumed exactly once.
    const resumePoint = loadPosition();
    let resumeKey = resumePoint?.key || null;
    let loadedKey = null; // favorites/resume key of the loaded media

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

    // Embedded artwork → blob URL. The tag's declared mime type comes from
    // the audio FILE, so only known image types are accepted (it feeds CSS
    // and mediaSession).
    const ARTWORK_TYPE = /^(image\/(?:jpeg|png|webp|gif|bmp))$/i;
    const pictureToUrl = (picture) => {
      if (!picture || !picture.data || !picture.data.length) return null;
      const bytes = new Uint8Array(picture.data);
      const type = ARTWORK_TYPE.test(picture.format)
        ? picture.format
        : "image/jpeg";
      return { url: URL.createObjectURL(new Blob([bytes], { type })), type };
    };

    // Same track asked by the playlist row and the player — parse it once.
    const pendingMeta = {};
    const getTrackMeta = (i) => {
      const track = shuffledArray[i];
      if (metaCache[track.path]) return Promise.resolve(metaCache[track.path]);
      return (pendingMeta[track.path] ||= new Promise((resolve) => {
        const fallback = parseFallbackName(track.name);
        jsmediatags.read(track.file || resolveTrackUrl(track), {
          onSuccess: (tag) => {
            const tags = tag.tags || {};
            const pic = pictureToUrl(tags.picture);
            const meta = {
              title: tags.title || fallback.title,
              artist: tags.artist || fallback.artist,
              album: tags.album || fallback.album,
              artworkUrl: pic?.url || DEFAULT_ARTWORK,
              artworkType: pic?.type || "image/jpeg",
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
      }));
    };

    const applyTrackMetadata = (i) => {
      const track = shuffledArray[i];
      const key = track.id || track.path;
      getTrackMeta(i).then((meta) => {
        if (key !== loadedKey) return; // another track started meanwhile
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
            // Embedded art shows on the lock screen / OS media controls.
            artwork:
              meta.artworkUrl === DEFAULT_ARTWORK
                ? []
                : [{ src: meta.artworkUrl, type: meta.artworkType }],
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
    if (typeof settings.lastTrackKey === "string") {
      const savedIndex = shuffledArray.findIndex(
        (track) => (track.id || track.path) === settings.lastTrackKey
      );
      if (savedIndex !== -1) index = savedIndex;
    } else if (typeof settings.lastTrack === "string") {
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

    // Mute is its own persisted flag — it never destroys the volume level,
    // so un-muting restores exactly what was playing before. On iOS the
    // muted flag is the ONLY sound control a web page gets (media.volume is
    // ignored there).
    const applyMutedUi = () => {
      muteBtnIcon.textContent =
        mutedState || currentVolume === 0 ? "no_sound" : "volume_down";
    };

    let volumeSaveTimer = null;
    const applyVolume = (volume) => {
      wavesurfer.setVolume(volume);
      volumeSlider.value = Math.round(volume * 100);
      currentVolume = volume;
      applyMutedUi();
      // Slider drags fire this dozens of times — debounce the localStorage write.
      clearTimeout(volumeSaveTimer);
      volumeSaveTimer = setTimeout(() => saveSettings({ volume }), 300);
    };

    const toggleMute = () => {
      if (!mutedState && wavesurfer.getVolume() > 0) {
        mutedState = true;
      } else {
        mutedState = false;
      }
      wavesurfer.setMuted(mutedState);
      applyMutedUi();
      saveSettings({ muted: mutedState });
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

    // Startup loading: when the last-played track is a LOCAL one, the async
    // restore below loads it — loading the server track first too would just
    // double the time until music is ready.
    let initialLoadDone = false;
    let hadSuccessfulReady = false;
    let pendingLoads = 0;
    // Serialize wavesurfer loads: overlapping load() calls race (fetch →
    // setSrc → decode → ready) and whichever finishes LAST owns media.src —
    // the audio would then mismatch the UI. Chaining guarantees the LAST
    // requested track is the one that actually plays.
    let loadChain = Promise.resolve();
    // End-of-playlist stop: the key of the track that must stay paused after
    // its load (the ready handler checks it instead of a bare once("ready"),
    // which raced play() and could pause an unrelated track).
    let pauseOnReadyKey = null;
    // A seek made while the next track is still loading would land on the
    // outgoing media — keep it and apply it once the new track is ready.
    let pendingSeek = null;
    const loadTrack = (i) => {
      if (!shuffledArray.length) return;
      pendingSeek = null;
      initialLoadDone = true;
      pendingLoads++;
      index = i;
      highlightPlaylist(index);
      const track = shuffledArray[index];
      // Fresh blob per load: wavesurfer revokes its previous media src, so a
      // long-lived per-track URL would be dead by the time the user cycles
      // back to this track.
      const url = track.file
        ? URL.createObjectURL(track.file)
        : resolveTrackUrl(track);
      loadChain = loadChain
        .then(() => wavesurfer.load(url))
        .finally(() => {
          pendingLoads--;
          if (track.file) URL.revokeObjectURL(url);
        })
        .catch((err) => console.error("Track load failed:", err));
    };

    const goToNextTrack = () => loadTrack((index + 1) % shuffledArray.length);
    const goToPrevTrack = () =>
      loadTrack((index - 1 + shuffledArray.length) % shuffledArray.length);

    // Local (folder/file) tracks are added asynchronously after startup, so
    // restoring the last-played one has to wait until they exist.
    let lastTrackRestored = false;
    const restoreLastLocalTrack = () => {
      const savedKey = settings.lastTrackKey;
      if (
        lastTrackRestored ||
        typeof savedKey !== "string" ||
        !savedKey.startsWith("local:")
      )
        return;
      const savedIndex = shuffledArray.findIndex(
        (track) => track.id === savedKey
      );
      if (savedIndex === -1) return;
      lastTrackRestored = true;
      loadTrack(savedIndex);
    };

    const loadInitial = () => {
      // A queued/running load covers the initial track; retry the server
      // track only when every earlier load already FAILED (never ready).
      if (initialLoadDone && (pendingLoads > 0 || hadSuccessfulReady)) return;
      initialLoadDone = true;
      loadTrack(index);
    };

    // ---------------------------------------------------------------------------
    // Audio events
    // ---------------------------------------------------------------------------

    wavesurfer.on("pause", () => {
      playPauseBtnIcon.textContent = "play_arrow";
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
      updatePositionState();
      // Key by loadedKey: when switching tracks, load() pauses the OLD media
      // while index already points at the new one.
      if (loadedKey && !loadedKey.startsWith("blob:") && wavesurfer.getDuration()) {
        savePosition(loadedKey, wavesurfer.getCurrentTime());
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
      // Continue where the last session left off — but only for the very
      // track that was playing when the page closed, and only on the first
      // load. Switching tracks always starts them at 0:00.
      const currentTrack = shuffledArray[index];
      const currentKey = currentTrack.id || currentTrack.path;
      const shouldResume = resumeKey !== null && currentKey === resumeKey;
      // Consumed once: later loads of the same track start from the top.
      if (shouldResume) resumeKey = null;
      if (pendingSeek !== null) {
        wavesurfer.setTime(
          Math.min(Math.max(pendingSeek, 0), wavesurfer.getDuration())
        );
        pendingSeek = null;
      } else if (
        shouldResume &&
        !mutedState &&
        resumePoint.time > 5 &&
        wavesurfer.getDuration() - resumePoint.time > 10
      ) {
        wavesurfer.setTime(resumePoint.time);
      }
      // Autoplay is blocked until the first user interaction — the track just
      // stays loaded and paused; playback starts on the first play click.
      // Resource selection resets mutedness to the (absent) muted content
      // attribute on EVERY load — re-assert the user's mute each time.
      wavesurfer.setMuted(mutedState);
      if (pauseOnReadyKey === currentKey) {
        // End of playlist: stay loaded and paused, don't restart track 1.
        pauseOnReadyKey = null;
        currentTime.textContent = formatTime(wavesurfer.getCurrentTime());
        remainingTime.textContent = `-${formatTime(wavesurfer.getDuration())}`;
      } else if (mutedState) {
        // Muted sessions never run on by themselves: when the current track
        // ends, stay paused at the next one. A tap plays it silently from 0.
        playPauseBtnIcon.textContent = "play_arrow";
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "paused";
        }
      } else {
        wavesurfer.play().catch(() => {
          // The "play" event already flipped the button to "pause" — restore it.
          playPauseBtnIcon.textContent = "play_arrow";
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        });
      }
      highlightPlaylist(index);
      // lastTrackKey is stable across reloads for both scanned tracks (their
      // audio/ path) and local tracks (their id); "lastTrack" name remains
      // for settings saved by older versions.
      saveSettings(
        currentTrack.local
          ? { lastTrackKey: currentKey }
          : { lastTrack: currentTrack.name, lastTrackKey: currentKey }
      );
      updatePositionState();
      // Firefox rasterizes the canvas stacks much slower than Chrome, and
      // renderProgress re-clips them EVERY frame — a full-length waveform
      // tanks its FPS. Cap the total width (~3 screens); Chrome keeps the
      // full-detail render.
      if (IS_FIREFOX && wavesurfer.getDuration() > 0) {
        const cap = Math.max(window.innerWidth * 3, 2400);
        const pxPerSec = cap / wavesurfer.getDuration();
        if (pxPerSec < options.minPxPerSec) wavesurfer.zoom(pxPerSec);
      }
      hadSuccessfulReady = true;
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
    });

    seekBar.addEventListener("input", () => {
      const value = Number(seekBar.value);
      // No loaded media yet (or a load in flight): the duration belongs to
      // another track, so remember the target for the ready handler.
      if (pendingLoads > 0 || !wavesurfer.getDuration()) {
        pendingSeek = value;
        return;
      }
      wavesurfer.seekTo(value / wavesurfer.getDuration());
      updatePositionState();
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
      for (const action of window.finishAction(
        shuffledArray.length,
        isRepeat,
        index
      )) {
        if (action === "next") {
          goToNextTrack();
        } else if (action === "next-paused") {
          // Keep the first track paused: the ready handler skips play() for
          // exactly this track.
          const next = (index + 1) % shuffledArray.length;
          pauseOnReadyKey = shuffledArray[next].id || shuffledArray[next].path;
          loadTrack(next);
        } else if (action === "rewind") {
          wavesurfer.seekTo(0);
        } else if (action === "play") {
          wavesurfer.play();
        }
      }
    });

    muteBtn.onclick = toggleMute;

    volumeUpBtn.onclick = () => {
      // Max volume also clears mute — otherwise it would stay silent.
      if (mutedState) {
        mutedState = false;
        saveSettings({ muted: false });
        wavesurfer.setMuted(false);
      }
      applyVolume(1);
    };

    volumeSlider.addEventListener("input", () =>
      applyVolume(Number(volumeSlider.value) / 100)
    );

    // Closes the panel and drops the hover card that pointed into it.
    const closeSidebar = () => {
      sidebar.classList.remove("active");
      // Declared further down, but only ever called from a user gesture.
      hideTooltip();
    };

    trackArt.onclick = () =>
      sidebar.classList.contains("active")
        ? closeSidebar()
        : sidebar.classList.add("active");
    app.querySelector(".sidebar .sidebar-overlay").onclick = closeSidebar;
    bgLayer.onclick = closeSidebar;

    // Touch only: swipe right opens the playlist, swipe left closes it.
    // Mouse/desktop keeps the art and backdrop clicks. No edge requirement:
    // on iOS the left-edge swipe belongs to the browser's back gesture.
    if (window.matchMedia("(pointer: coarse)").matches) {
      const MIN_SWIPE_PX = 60;
      let startX = 0;
      let startY = 0;
      let tracking = false;
      // Sliders, text fields and the chip strip own their horizontal drags.
      const ownsDrag = (target) =>
        target instanceof Element &&
        Boolean(target.closest("input, textarea, select, #folder-chip-list"));

      document.addEventListener(
        "touchstart",
        (e) => {
          const touch = e.touches[0];
          // One finger anywhere except on a control that drags sideways.
          tracking = !ownsDrag(e.target) && e.touches.length === 1;
          if (!tracking) return;
          startX = touch.clientX;
          startY = touch.clientY;
        },
        { passive: true }
      );

      document.addEventListener(
        "touchend",
        (e) => {
          if (!tracking) return;
          tracking = false;
          const touch = e.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          // Mostly horizontal and long enough, or it was a tap or a scroll.
          if (Math.abs(dx) < MIN_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5)
            return;
          if (dx > 0) sidebar.classList.add("active");
          else closeSidebar();
        },
        { passive: true }
      );
    }

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
    // fall back to a webkitdirectory input (session-only). Each folder is
    // stored under its own key, so several stay linked side by side.
    folderBtn.addEventListener("click", async () => {
      // A long-press just cleared the category — swallow that click.
      if (folderBtn.__longFired) {
        folderBtn.__longFired = false;
        return;
      }
      if (typeof window.showDirectoryPicker === "function") {
        try {
          const handle = await window.showDirectoryPicker({ mode: "read" });
          // One key per folder — picking a new one never replaces or removes
          // an already linked folder.
          await idbSet(`dirHandle:${handle.name}`, handle).catch(() => {});
          liftFolderExclusions(handle.name);
          saveSettings({ excludedTracks: [...excludedTracks] });
          const tracks = (await scanDirHandle(handle)).filter(
            (t) => !excludedTracks.has(t.id)
          );
          addTracks(tracks);
          linkFolder(handle.name, handle);
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
      files.forEach((file) => {
        const key = `dirfile:${file.webkitRelativePath || file.name}:${file.size}`;
        // Re-picking a cleared folder lifts its tombstones.
        if (removedFileKeys.delete(key)) {
          saveSettings({ removedFileKeys: [...removedFileKeys] });
        }
        // No directory handle on this browser (Firefox, Android, iOS) —
        // persist each file so the folder survives reloads.
        idbSet(key, file).catch(() => {});
      });
      addTracks(
        files.map((file) => {
          const relPath = file.webkitRelativePath || file.name;
          return {
            name: file.name.replace(/\.[^.]+$/, ""),
            path: URL.createObjectURL(file),
            file,
            local: true,
            source: "folder",
            folderId: folderIdFromRelPath(relPath),
            id: `local:${relPath}:${file.size}`,
          };
        })
      );
      if (files.length) {
        // Fallback picks have no handle — the top-level dir name is the
        // folder's identity for its chip and per-folder unlinking.
        const folderId = folderIdFromRelPath(
          files[0].webkitRelativePath || files[0].name
        );
        liftFolderExclusions(folderId);
        saveSettings({ excludedTracks: [...excludedTracks] });
        linkFolder(folderId, null);
      }
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
      if (!shuffledArray.length) return;
      isShuffle = !isShuffle;
      shuffleBtnIcon.style.color = isShuffle ? "#4676f9" : "#4d4d4d";
      // Relocate the current track by its stable key — duplicate file names
      // (same song from two folders) would otherwise land on the wrong one.
      const currentKey = shuffledArray[index].id || shuffledArray[index].path;
      shuffledArray = isShuffle
        ? shuffleArray(shuffledArray.slice())
        : allTracks.slice();
      index = shuffledArray.findIndex(
        (track) => (track.id || track.path) === currentKey
      );
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
      let visible = 0;
      document.querySelectorAll(".tbody-playlist").forEach((row) => {
        const track = shuffledArray[Number(row.dataset.index)];
        const info = row.querySelector(".tp-info");
        const matchesQuery =
          query === "" ||
          (info?.textContent || "").toLowerCase().includes(query);
        const matchesFavorites = !favOnly || favorites.has(track?.id || track?.path);
        // Server songs have no folder, so they hide while a folder is filtered.
        const matchesFolder = !folderFilter || track?.folderId === folderFilter;
        row.hidden = !matchesQuery || !matchesFavorites || !matchesFolder;
        if (!row.hidden) visible++;
      });
      // A fully filtered list must explain itself — a blank area looks broken.
      const emptyHint = document.querySelector("#playlist-empty");
      if (emptyHint) {
        emptyHint.textContent = favOnly
          ? query
            ? "No favorites match your search."
            : "No favorites yet — tap the heart on a song to pin it here."
          : "No songs match your search.";
        emptyHint.hidden = visible > 0;
      }
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
        (track) =>
          (!favOnly || favorites.has(track.id || track.path)) &&
          (!folderFilter || track.folderId === folderFilter)
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
              // Fallback picks persist per file — tombstone them too so the
              // track stays removed (handle-linked tracks have no such
              // entries, so this is a harmless no-op for them).
              const key = `dirfile:${(item.id || "").slice("local:".length)}`;
              if (/^(?:dir)?file:.+:\d+$/.test(key)) {
                removedFileKeys.add(key);
                saveSettings({ removedFileKeys: [...removedFileKeys] });
                idbDel(key).catch(() => {});
              }
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
          applySearchFilter();
        });

        loadDuration(item, (seconds) => {
          updatePlaylistSubtitle();
          if (!row.isConnected) return;
          duration.textContent =
            Number.isFinite(seconds) && seconds > 0 ? formatTime(seconds) : "--:--";
        });
      });
      updateFilesChip();
      const emptyHint = document.createElement("div");
      emptyHint.id = "playlist-empty";
      emptyHint.className = "playlist-status";
      emptyHint.hidden = true;
      tbody.append(emptyHint);
      applySearchFilter();
    };

    // The row truncates with an ellipsis, so hover shows the whole record.
    const tooltipEl = document.querySelector("#track-tooltip");
    // Long enough that clicking a row never flashes a card; short enough that
    // a deliberate hover still feels immediate.
    const HOVER_DELAY_MS = 700;
    let hoveredRow = null;
    let pendingRow = null;
    let hoverTimer = 0;

    const hideTooltip = () => {
      clearTimeout(hoverTimer);
      hoverTimer = 0;
      pendingRow = null;
      hoveredRow = null;
      if (tooltipEl) tooltipEl.hidden = true;
    };

    const describeSource = (track) => {
      if (track.source === "folder") return `Thư mục: ${track.folderId}`;
      if (track.source === "file") return "Tệp đã thêm";
      return "Máy chủ (audio/)";
    };

    const sourceIcon = (track) => {
      if (track.source === "folder") return "folder_open";
      if (track.source === "file") return "upload_file";
      return "cloud";
    };

    // Returns the parts that arrive with the tags: the caller fills them once
    // getTrackMeta settles.
    const fillTooltip = (track) => {
      const fallback = parseFallbackName(track.name);
      tooltipEl.textContent = "";
      // Same shape as a playlist row: cover, title, artist — then the fields
      // the row truncates.
      const head = document.createElement("div");
      head.className = "tp-tip-head";
      const art = document.createElement("img");
      art.className = "tp-tip-art";
      art.src = DEFAULT_ARTWORK;
      art.alt = "";
      const names = document.createElement("div");
      names.className = "tp-tip-name";
      const title = document.createElement("div");
      title.className = "tp-tip-title";
      title.textContent = fallback.title;
      const artist = document.createElement("div");
      artist.className = "tp-tip-artist";
      artist.textContent = fallback.artist;
      names.append(title, artist);
      head.append(art, names);
      tooltipEl.append(head);

      const body = document.createElement("div");
      body.className = "tp-tip-body";
      tooltipEl.append(body);

      const field = (icon, label, value) => {
        const line = document.createElement("div");
        line.className = "tp-tip-row";
        const glyph = document.createElement("span");
        glyph.className = "material-symbols-rounded tp-tip-icon";
        glyph.textContent = icon;
        const name = document.createElement("span");
        name.className = "tp-tip-label";
        name.textContent = label;
        const text = document.createElement("span");
        text.className = "tp-tip-value";
        text.textContent = value;
        line.append(glyph, name, text);
        body.append(line);
        return text;
      };

      const album = field("album", "Album", "…");
      const seconds = durationCache[track.path];
      field(
        "schedule",
        "Thời lượng",
        Number.isFinite(seconds) && seconds > 0 ? formatTime(seconds) : "—"
      );
      field(sourceIcon(track), "Nguồn", describeSource(track));
      field("description", "Tệp", track.name);
      return { album, art };
    };

    const placeTooltip = (row) => {
      const rect = row.getBoundingClientRect();
      const tip = tooltipEl.getBoundingClientRect();
      const gap = 8;
      const left = Math.min(
        Math.max(gap, rect.left + gap),
        window.innerWidth - tip.width - gap
      );
      // Above the row when it fits, below it otherwise.
      const above = rect.top - tip.height - gap;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${Math.max(
        gap,
        above >= gap
          ? above
          : Math.min(rect.bottom + gap, window.innerHeight - tip.height - gap)
      )}px`;
    };

    const showTooltip = (row) => {
      const track = shuffledArray[Number(row.dataset.index)];
      if (!track) return;
      hoveredRow = row;
      const { album, art } = fillTooltip(track);
      tooltipEl.hidden = false;
      placeTooltip(row);
      getTrackMeta(Number(row.dataset.index)).then((meta) => {
        if (hoveredRow !== row) return;
        album.textContent = meta.album || "—";
        art.src = meta.artworkUrl;
        placeTooltip(row);
      });
    };

    const playlistBody = document.querySelector(".tbody");
    // pointermove, not pointerover: a panel that slides in under a resting
    // cursor must not pop a card nobody asked for.
    playlistBody?.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || !tooltipEl) return;
      const row = e.target.closest?.(".tbody-playlist");
      if (!row || row === pendingRow) return;
      pendingRow = row;
      clearTimeout(hoverTimer);
      // Moving straight to another row drops the old card instead of leaving
      // a stale one under the pointer for two seconds.
      if (hoveredRow && hoveredRow !== row) hideTooltip();
      pendingRow = row;
      hoverTimer = setTimeout(() => {
        if (pendingRow === row) showTooltip(row);
      }, HOVER_DELAY_MS);
    });
    playlistBody?.addEventListener("pointerout", (e) => {
      const to = e.relatedTarget;
      if (hoveredRow && to instanceof Node && hoveredRow.contains(to)) return;
      if (pendingRow && to instanceof Node && pendingRow.contains(to)) return;
      hideTooltip();
    });
    // Any scroll (sidebar list, page) moves the row out from under the card.
    document.addEventListener("scroll", hideTooltip, true);

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
        `This will remove ${folderTracks.length} songs from ALL linked folders. The folders stay linked.`,
        "Continue"
      );
      if (!ok) return;
      // The folders stay linked — exclusions keep these songs out of rescans;
      // tombstones keep fallback-persisted files out of the IDB restore.
      folderTracks.forEach((t) => {
        excludedTracks.add(t.id);
        const key = `dirfile:${(t.id || "").slice("local:".length)}`;
        if (/^(?:dir)?file:.+:\d+$/.test(key)) {
          removedFileKeys.add(key);
          idbDel(key).catch(() => {});
        }
      });
      saveSettings({
        excludedTracks: [...excludedTracks],
        removedFileKeys: [...removedFileKeys],
      });
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

    // Visible delete-all chip for added files (mirrors the folder chip).
    const updateFilesChip = () => {
      if (!filesChip) return;
      const n = allTracks.filter((t) => t.source === "file").length;
      filesChipName.textContent = `${n} added ${n === 1 ? "song" : "songs"}`;
      filesChip.hidden = n === 0;
    };
    filesUnlinkBtn?.addEventListener("click", () => clearFileTracksFlow());

    // Remove tracks from the playlist. Favorites are keyed by stable ids, so
    // they stay: re-adding the same folder/file restores the hearts.
    const removeTracks = (targets) => {
      if (!targets.length) return;
      const keys = new Set(targets.map((t) => t.id || t.path));
      const wasLoaded = keys.has(loadedKey);
      const wasPlaying = wavesurfer.isPlaying();
      allTracks = allTracks.filter((t) => !keys.has(t.id || t.path));
      shuffledArray = shuffledArray.filter((t) => !keys.has(t.id || t.path));
      if (!shuffledArray.length) {
        wavesurfer.stop();
        loadedKey = null;
        index = 0;
        renderPlaylist();
        updatePlaylistSubtitle();
        return;
      }
      // Filtering shifts every row before the playing one — recompute the
      // index from its key instead of clamping the now-stale one.
      const currentIndex = shuffledArray.findIndex(
        (t) => (t.id || t.path) === loadedKey
      );
      index =
        currentIndex !== -1
          ? currentIndex
          : Math.min(index, shuffledArray.length - 1);
      renderPlaylist();
      updatePlaylistSubtitle();
      if (wasLoaded) {
        // A paused player stays paused: hold the replacement through ready.
        if (!wasPlaying) {
          const next = shuffledArray[index];
          pauseOnReadyKey = next.id || next.path;
        }
        loadTrack(index);
      } else {
        highlightPlaylist(index);
      }
    };

    // Linked folders in add order (a Map keeps insertion order) — the chip
    // list's source of truth. The handle is kept for later permission
    // requests; fallback picks register with null (no handle on this
    // browser).
    const linkedFolders = new Map();

    // One chip per linked folder, built at runtime (the HTML ships an empty
    // container). Hidden entirely when nothing is linked.
    const renderFolderChips = () => {
      if (!folderChipList) return;
      folderChipList.textContent = "";
      // Registry order first, then folder ids only seen on tracks — every
      // folder with songs gets a chip even if it missed the registry.
      const ids = [...linkedFolders.keys()];
      const seen = new Set(ids);
      allTracks.forEach((t) => {
        if (t.source === "folder" && t.folderId && !seen.has(t.folderId)) {
          seen.add(t.folderId);
          ids.push(t.folderId);
        }
      });
      ids.forEach((id) => {
        const chip = document.createElement("div");
        chip.className = folderFilter === id ? "folder-chip active" : "folder-chip";
        // Clicking the chip filters the playlist to it; clicking again clears.
        chip.onclick = () => {
          folderFilter = folderFilter === id ? null : id;
          renderFolderChips();
          applySearchFilter();
          updatePlaylistSubtitle();
        };
        const icon = document.createElement("span");
        icon.className = "material-symbols-rounded";
        icon.textContent = "folder_open";
        const label = document.createElement("span");
        label.className = "folder-chip-name";
        label.textContent = id;
        const unlink = document.createElement("button");
        unlink.type = "button";
        unlink.className = "folder-chip-unlink";
        unlink.setAttribute("aria-label", "Unlink music folder");
        const unlinkIcon = document.createElement("span");
        unlinkIcon.className = "material-symbols-rounded";
        unlinkIcon.textContent = "close";
        unlink.append(unlinkIcon);
        unlink.onclick = (e) => {
          e.stopPropagation(); // unlinking must not also toggle the filter
          unlinkFolderFlow(id);
        };
        chip.append(icon, label, unlink);
        folderChipList.append(chip);
      });
      folderChipList.hidden = ids.length === 0;
    };

    // The strip slides: touch swipes natively (pan-x), desktop mice get a
    // grab-drag here. A click ending a real drag is swallowed so sliding
    // past a ✕ never unlinks by accident.
    if (folderChipList) {
      let dragX = null;
      let dragMoved = false;
      let dragVelocity = 0; // scrollLeft px per pointermove, smoothed
      let wheelTarget = null;
      let glideRaf = 0;

      // Single rAF runner for both easing motions (wheel glide and drag
      // momentum); starting one cancels the other, a grab cancels both.
      const glide = (step) => {
        cancelAnimationFrame(glideRaf);
        const frame = () => {
          if (step() !== false) glideRaf = requestAnimationFrame(frame);
        };
        glideRaf = requestAnimationFrame(frame);
      };
      const clampLeft = (v) =>
        Math.max(
          0,
          Math.min(folderChipList.scrollWidth - folderChipList.clientWidth, v)
        );

      folderChipList.addEventListener("pointerdown", (e) => {
        cancelAnimationFrame(glideRaf);
        wheelTarget = null;
        if (e.pointerType !== "mouse") return;
        dragX = e.clientX;
        dragMoved = false;
        dragVelocity = 0;
      });
      folderChipList.addEventListener("pointermove", (e) => {
        if (dragX === null) return;
        const dx = e.clientX - dragX;
        if (Math.abs(dx) < 5) return;
        if (!dragMoved) {
          dragMoved = true;
          // Capture only once it is a real drag: capturing on pointerdown
          // would retarget the click too and ✕ would stop receiving clicks.
          try {
            folderChipList.setPointerCapture(e.pointerId);
          } catch {}
        }
        dragX = e.clientX;
        folderChipList.scrollLeft -= dx;
        dragVelocity = 0.8 * -dx + 0.2 * dragVelocity;
      });
      const endDrag = () => {
        if (dragX === null) return;
        dragX = null;
        // Momentum glide after a real fling — a hard stop feels jerky.
        if (!dragMoved || Math.abs(dragVelocity) < 2) return;
        let v = dragVelocity;
        glide(() => {
          const left = folderChipList.scrollLeft;
          folderChipList.scrollLeft = clampLeft(left + v);
          v *= 0.92;
          if (
            Math.abs(v) < 0.5 ||
            folderChipList.scrollLeft === left // hit an edge
          ) {
            glideRaf = 0;
            return false;
          }
        });
      };
      folderChipList.addEventListener("pointerup", endDrag);
      folderChipList.addEventListener("pointerleave", endDrag);
      folderChipList.addEventListener("pointercancel", endDrag);
      // A plain vertical wheel scrolls the strip too — desktop mice have no
      // horizontal wheel of their own (shift+wheel arrives as deltaX
      // already). Notches ease toward a running target instead of snapping.
      folderChipList.addEventListener(
        "wheel",
        (e) => {
          if (e.deltaX || !e.deltaY) return;
          e.preventDefault();
          const max =
            folderChipList.scrollWidth - folderChipList.clientWidth;
          const base =
            wheelTarget === null ? folderChipList.scrollLeft : wheelTarget;
          wheelTarget = clampLeft(base + e.deltaY);
          glide(() => {
            const left = folderChipList.scrollLeft;
            if (Math.abs(wheelTarget - left) < 1) {
              folderChipList.scrollLeft = wheelTarget;
              wheelTarget = null;
              glideRaf = 0;
              return false;
            }
            folderChipList.scrollLeft = left + (wheelTarget - left) * 0.2;
          });
        },
        { passive: false }
      );
      folderChipList.addEventListener(
        "click",
        (e) => {
          if (!dragMoved) return;
          dragMoved = false;
          e.preventDefault();
          e.stopPropagation();
        },
        true
      );
    }

    // Register a linked folder — a no-op for an already linked one, so
    // re-picking keeps the original chip order.
    const linkFolder = (folderId, handle) => {
      if (!linkedFolders.has(folderId)) linkedFolders.set(folderId, handle);
      renderFolderChips();
    };

    // Handles still awaiting read permission after a reload — the restore
    // banner offers them one at a time: a grant scans that folder, then the
    // banner re-points itself at the next pending one (or hides).
    let pendingRestoreHandles = [];
    let bannerHandle = null;

    // Scan a granted handle and merge its songs (minus previously removed
    // ones) into the playlist. Re-checks the stored key so a folder unlinked
    // mid-restore is not resurrected by an in-flight scan.
    const restoreDirHandle = async (handle) => {
      if (!(await idbGet(`dirHandle:${handle.name}`))) return;
      const tracks = (await scanDirHandle(handle)).filter(
        (t) => !excludedTracks.has(t.id)
      );
      addTracks(tracks);
      linkFolder(handle.name, handle);
      // Resume the last folder track, but never yank active playback.
      if (!wavesurfer.isPlaying()) restoreLastLocalTrack();
    };

    const showRestoreBannerForNext = () => {
      bannerHandle = pendingRestoreHandles.shift() || null;
      if (!restoreBanner) return;
      if (!bannerHandle) {
        restoreBanner.hidden = true;
        return;
      }
      restoreName.textContent = bannerHandle.name;
      restoreBanner.hidden = false;
      restoreBanner.onclick = async () => {
        const handle = bannerHandle;
        if (
          (await handle.requestPermission({ mode: "read" })) !== "granted"
        )
          return;
        restoreBanner.hidden = true;
        // The folder may have been unlinked while the prompt was open.
        if (linkedFolders.has(handle.name)) await restoreDirHandle(handle);
        showRestoreBannerForNext();
      };
    };

    // Unlink ONE folder (its chip's close button): drop the handle, remove
    // only its songs, tombstone its persisted fallback files and lift only
    // its exclusions — other folders keep their tracks, tombstones and
    // exclusion entries. Works without a handle too — fallback-persisted
    // folder files get tombstoned so they stay unlinked after a reload.
    const unlinkFolderFlow = async (folderId) => {
      const folderTracks = allTracks.filter(
        (t) => t.source === "folder" && t.folderId === folderId
      );
      // Same two-step confirmation as clearing added files.
      const ok = await confirmTwice(
        "Unlink music folder?",
        folderTracks.length
          ? `This will remove ${folderTracks.length} songs from "${folderId}" and forget it.`
          : `This will forget the folder "${folderId}".`,
        "Continue"
      );
      if (!ok) return;
      // Drop the handle even when its permission was never granted (banner
      // pending) — otherwise the banner keeps offering a removed folder.
      await idbDel(`dirHandle:${folderId}`).catch(() => {});
      linkedFolders.delete(folderId);
      // A pending banner for THIS folder must stop offering it; other
      // pending folders stay queued.
      pendingRestoreHandles = pendingRestoreHandles.filter(
        (h) => h.name !== folderId
      );
      if (bannerHandle?.name === folderId) {
        bannerHandle = null;
        showRestoreBannerForNext();
      }
      folderTracks.forEach((t) => {
        const key = `dirfile:${(t.id || "").slice("local:".length)}`;
        if (/^(?:dir)?file:.+:\d+$/.test(key)) {
          removedFileKeys.add(key);
          idbDel(key).catch(() => {});
        }
      });
      // Exclusions only mattered while the folder was linked — lift exactly
      // its entries so re-linking starts fresh. Never .clear(): that would
      // un-hide other folders' removed songs on their next rescan.
      liftFolderExclusions(folderId);
      // The filtered folder is gone; never keep hiding the rest behind it.
      if (folderFilter === folderId) folderFilter = null;
      saveSettings({
        excludedTracks: [...excludedTracks],
        removedFileKeys: [...removedFileKeys],
      });
      removeTracks(folderTracks);
      renderFolderChips();
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
        closeSidebar();
      }
    });

    // Initial load — skipped when the last-played track is a local one (the
    // restore below loads it instead); the timeout covers a slow/failed
    // restore so the player is never left empty.
    if (
      typeof settings.lastTrackKey === "string" &&
      settings.lastTrackKey.startsWith("local:")
    ) {
      setTimeout(loadInitial, 1500);
    } else {
      loadInitial();
    }
    applyVolume(currentVolume);
    // Restore the remembered mute state. Safe on iOS: the ready handler
    // refuses to auto-play while muted, so nothing runs on by itself.
    if (mutedState) {
      wavesurfer.setMuted(true);
      applyMutedUi();
    }

    // iOS: NO web page can change volume — the hardware buttons own it. Hide
    // the controls instead of showing ones that can't work, and force-clear
    // any stale stored mute: a muted iOS player would be silent with no
    // visible way back.
    const volumeGroup = app.querySelector(".volume-control-btn");
    if (IS_IOS && volumeGroup) {
      volumeGroup.style.display = "none";
      if (mutedState) {
        mutedState = false;
        wavesurfer.setMuted(false);
        saveSettings({ muted: false });
      }
      showToast("On iOS, use the device's volume buttons");
    }

    renderPlaylist();
    if (emptyMessage) renderPlaylistStatus(emptyMessage);
    // Establish the chip container's state even before anything is linked.
    renderFolderChips();

    // Restore user-added local music from a previous session.
    (async () => {
      try {
        const stored = (await idbGetByPrefix("file:")).filter(
          (entry) => !removedFileKeys.has(String(entry.key))
        );
        addTracks(tracksFromFiles(stored.map((entry) => entry.value)));
        restoreLastLocalTrack();
        const dirStored = (await idbGetByPrefix("dirfile:")).filter(
          (entry) => !removedFileKeys.has(String(entry.key))
        );
        addTracks(tracksFromDirFileEntries(dirStored));
        // One chip per restored fallback folder, grouped by folder id —
        // these folders have no handle on this browser.
        const restoredFolderIds = [
          ...new Set(
            dirStored.map((entry) => folderIdFromDirFileKey(entry.key))
          ),
        ];
        restoredFolderIds.forEach((id) => linkFolder(id, null));
        restoreLastLocalTrack();
        // One-time migration: builds before multi-folder support stored a
        // single handle under "dirHandle" — file it under its per-folder key
        // (unless a newer entry already exists) and drop the legacy key.
        const legacyHandle = await idbGet("dirHandle");
        if (legacyHandle?.name) {
          if (!(await idbGet(`dirHandle:${legacyHandle.name}`))) {
            await idbSet(`dirHandle:${legacyHandle.name}`, legacyHandle).catch(
              () => {}
            );
          }
          await idbDel("dirHandle").catch(() => {});
        }
        // Every stored folder is linked (and gets its chip, even while its
        // permission is still pending) — granted ones scan right away, the
        // rest queue up for the restore banner.
        const storedHandles = await idbGetByPrefix("dirHandle:");
        for (const { value: handle } of storedHandles) {
          if (!handle || typeof handle.name !== "string") continue;
          linkFolder(handle.name, handle);
          try {
            if (
              (await handle.queryPermission({ mode: "read" })) === "granted"
            ) {
              await restoreDirHandle(handle);
            } else {
              pendingRestoreHandles.push(handle);
            }
          } catch {
            pendingRestoreHandles.push(handle);
          }
        }
        if (pendingRestoreHandles.length) showRestoreBannerForNext();
      } catch {
        // IndexedDB unavailable — local music stays session-only.
      } finally {
        // Restore settled and loaded nothing → load the initial server track.
        loadInitial();
      }
    })();

    // Persist the current track position when the page is being closed.
    // pagehide fires where beforeunload doesn't (mobile Safari/Chrome).
    const savePositionNow = () => {
      if (loadedKey && !loadedKey.startsWith("blob:") && wavesurfer.getDuration()) {
        savePosition(loadedKey, wavesurfer.getCurrentTime());
      }
    };
    window.addEventListener("beforeunload", savePositionNow);
    window.addEventListener("pagehide", savePositionNow);
  });

  // Test hook: the pure id/identity helpers behind the multi-folder logic,
  // so tests can assert the derivation without a picker or IndexedDB.
  if (typeof window !== "undefined") {
    window.__folderTestHooks = {
      buildFolderTrackId,
      folderIdFromRelPath,
      folderIdFromDirFileKey,
    };
  }
})();
