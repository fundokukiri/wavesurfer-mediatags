var contents = document.querySelector("#app-content"),
  trackArt = contents.querySelector(".album-art img"),
  trackName = contents.querySelector(".track-name #name"),
  trackArtist = contents.querySelector(".track-name #artist"),
  trackAlbum = contents.querySelector(".track-name #album"),
  bgArtwork = contents.querySelector("#bg-artwork"),
  bgLayer = contents.querySelector("#bg-layer"),
  seekBar = contents.querySelector("#track-seek-bar"),
  playPauseBtn = contents.querySelector(".play-pause"),
  playPauseBtnIcon = contents.querySelector(".play-pause span"),
  repeatBtn = contents.querySelector(".repeat-btn"),
  repeatBtnIcon = contents.querySelector(".repeat-btn span"),
  prevBtn = contents.querySelector("#prev"),
  ShuffleBtn = contents.querySelector(".shuffleBtn"),
  ShuffleBtnIcon = contents.querySelector(".shuffleBtn span"),
  nextBtn = contents.querySelector("#next"),
  muteBtn = contents.querySelector(".mute-volume"),
  muteBtnIcon = contents.querySelector(".mute-volume span"),
  volumeUpBtn = contents.querySelector(".volume-up"),
  volumeSlider = contents.querySelector("#volume-control-slider"),
  currentTime = contents.querySelector("#current-time"),
  remainingTime = contents.querySelector("#remaining-time"),
  albumArt = contents.querySelector(".album-art img"),
  timeSeekBar = contents.querySelector("#track-seek-bar");

options = {
  container: "#waveform",
  waveColor: "#b5b7b8",
  progressColor: "#000000",
  height: 50,
  barWidth: 2,
  barHeight: 1,
  responsive: true,
  hideScrollbar: true,
  cursorWidth: 0,
  interact: 0,
  barRadius: 3,
  backend: "MediaElementWebAudio",
  minPxPerSec: 100,
  mediaControls: false,
  autoScroll: true,
  autoCenter: true,
  audioRate: 1,
  normalize: 0,
};

var metaCache = {};

document.addEventListener("DOMContentLoaded", function () {
  var index = 0;
  var isRepeat = 0;
  var isShuffle = false;
  var curentVolume = 1;
  var shuffledArray = playList.slice();
  var wavesurfer = WaveSurfer.create(options);

  // Prevent waveform from capturing pointer events (interact=0 doesn't fully stop it)
  setTimeout(function () {
    var wrapper = wavesurfer.getWrapper && wavesurfer.getWrapper();
    if (wrapper) wrapper.style.pointerEvents = "none";
  }, 0);

  navigator.mediaSession = navigator.mediaSession || {};
  navigator.mediaSession.setActionHandler =
    navigator.mediaSession.setActionHandler || function () {};
  window.MediaMetadata = window.MediaMetadata || function () {};

  wavesurfer.load(shuffledArray[index].path);

  wavesurfer.on("pause", function () {
    playPauseBtnIcon.innerHTML = "play_arrow";
    var curItem = document.querySelector(".tbody-playlist.active");
    if (curItem) curItem.classList.remove("playing");
  });

  wavesurfer.on("play", function () {
    playPauseBtnIcon.innerHTML = "pause";
    var curItem = document.querySelector(".tbody-playlist.active");
    if (curItem) curItem.classList.add("playing");
  });

  playPauseBtn.onclick = function () {
    wavesurfer.playPause();
  };

  wavesurfer.on("ready", function () {
    readMediatag(index);
    currentTime.innerText = formatTime(0);
    remainingTime.innerText = "-" + formatTime(wavesurfer.getDuration());
    wavesurfer.play();
    highlightPlaylist(index);
  });

  function formatTime(seconds) {
    var minutes = Math.floor(seconds / 60),
      seconds = Math.floor(seconds % 60);
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  wavesurfer.on("audioprocess", function () {
    seekBar.value = Math.floor(wavesurfer.getCurrentTime());
    seekBar.max = Math.floor(wavesurfer.getDuration());
    currentTime.innerText = formatTime(wavesurfer.getCurrentTime());
    remainingTime.innerText =
      "-" + formatTime(wavesurfer.getDuration() - wavesurfer.getCurrentTime());
  });

  timeSeekBar.addEventListener("input", function () {
    var duration = wavesurfer.getDuration();
    if (duration && duration > 0) {
      wavesurfer.seekTo(timeSeekBar.value / duration);
    }
  });

  repeatBtn.onclick = function () {
    isRepeat = (isRepeat + 1) % 3;
    switch (isRepeat) {
      case 1:
        repeatBtnIcon.innerHTML = "repeat";
        repeatBtnIcon.style.color = "#4676f9";
        break;
      case 2:
        repeatBtnIcon.innerHTML = "repeat_one";
        break;
      default:
        repeatBtnIcon.innerHTML = "repeat";
        repeatBtnIcon.style.color = "#4d4d4d";
    }
  };

  function loadTrack(i) {
    index = i;
    wavesurfer.load(shuffledArray[index].path);
    highlightPlaylist(index);
  }

  nextBtn.onclick = function () {
    loadTrack((index + 1) % playList.length);
  };

  prevBtn.onclick = function () {
    loadTrack((index - 1 + playList.length) % playList.length);
  };

  navigator.mediaSession.setActionHandler("previoustrack", prevBtn.onclick);
  navigator.mediaSession.setActionHandler("nexttrack", nextBtn.onclick);

  wavesurfer.on("finish", function () {
    switch (isRepeat) {
      case 1:
        loadTrack((index + 1) % playList.length);
        break;
      case 2:
        wavesurfer.seekTo(0);
        wavesurfer.play();
        break;
      default:
        var next = (index + 1) % playList.length;
        loadTrack(next);
        if (next === 0) {
          wavesurfer.once("ready", function () {
            wavesurfer.pause();
            currentTime.innerText = formatTime(0);
            remainingTime.innerText = "-" + formatTime(wavesurfer.getDuration());
          });
        }
    }
  });

  muteBtn.onclick = function () {
    if (wavesurfer.getVolume() > 0) {
      curentVolume = wavesurfer.getVolume();
      wavesurfer.setVolume(0);
      muteBtnIcon.innerHTML = "no_sound";
      volumeSlider.value = 0;
    } else {
      muteBtnIcon.innerHTML = "volume_down";
      if (curentVolume == 0) {
        volumeSlider.value = 30;
        wavesurfer.setVolume(0.3);
      } else {
        volumeSlider.value = curentVolume * 100;
        wavesurfer.setVolume(curentVolume);
      }
    }
  };

  volumeUpBtn.onclick = function () {
    wavesurfer.setVolume(1);
    volumeSlider.value = 100;
    muteBtnIcon.innerHTML = "volume_down";
  };

  volumeSlider.addEventListener("input", function () {
    muteBtnIcon.innerHTML =
      volumeSlider.value != 0 ? "volume_down" : "no_sound";
    wavesurfer.setVolume(volumeSlider.value / 100);
    curentVolume = volumeSlider.value / 100;
  });

  albumArt.onclick = function () {
    document.querySelector(".sidebar").classList.toggle("active");
  };
  document.querySelector(".sidebar .sidebar-overlay").onclick = function () {
    document.querySelector(".sidebar").classList.remove("active");
  };
  bgLayer.onclick = function () {
    document.querySelector(".sidebar").classList.remove("active");
  };

  ShuffleBtn.onclick = function () {
    isShuffle = !isShuffle;
    ShuffleBtnIcon.style.color = isShuffle ? "#4676f9" : "#4d4d4d";
    var curName = playList[index].name;
    shuffledArray = isShuffle
      ? shuffleArray(shuffledArray.slice())
      : playList.slice();
    index = shuffledArray.findIndex(function (item) {
      return item.name === curName;
    });
    renderPlaylist();
    highlightPlaylist(index);
  };

  function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function base64FromPicture(picture) {
    var base64String = "";
    for (var k = 0; k < picture.data.length; k++) {
      base64String += String.fromCharCode(picture.data[k]);
    }
    return "data:" + picture.format + ";base64," + window.btoa(base64String);
  }

  function readMeta(i) {
    if (metaCache[i]) return Promise.resolve(metaCache[i]);
    return new Promise(function (resolve) {
      var url = window.location.href;
      var separator = "/";
      var parts = url.split(separator);
      var remainingUrl =
        parts[0] +
        separator +
        separator +
        parts[2] +
        separator +
        parts[3] +
        separator;
      jsmediatags.read(remainingUrl + shuffledArray[i].path, {
        onSuccess: function (tag) {
          var t = tag.tags || {};
          var meta = {
            title: t.title || shuffledArray[i].name.split("-")[1],
            artist: t.artist || shuffledArray[i].name.split("-")[0],
            album: t.album || shuffledArray[i].name.split("-")[1],
            picture: t.picture || null,
          };
          metaCache[i] = meta;
          resolve(meta);
        },
        onError: function () {
          var meta = {
            title: shuffledArray[i].name.split("-")[1],
            artist: shuffledArray[i].name.split("-")[0],
            album: shuffledArray[i].name.split("-")[1],
            picture: null,
          };
          metaCache[i] = meta;
          resolve(meta);
        },
      });
    });
  }

  function readMediatag(i) {
    var url = window.location.href;
    var separator = "/";
    var parts = url.split(separator);
    var remainingUrl =
      parts[0] +
      separator +
      separator +
      parts[2] +
      separator +
      parts[3] +
      separator;
    jsmediatags.read(remainingUrl + shuffledArray[i].path, {
      onSuccess: function (tag) {
        var tags = tag.tags;
        var image = tags.picture;
        if (image) {
          trackArt.src = base64FromPicture(image);
          bgArtwork.style.backgroundImage = "url('" + trackArt.src + "')";
        } else {
          trackArt.src = "./assets/images/default-icon.jpg";
          bgArtwork.style.backgroundImage =
            "url('./assets/images/default-icon.jpg')";
        }
        document.title = tags.title
          ? tags.title + " | " + tags.artist
          : shuffledArray[i].name.split("-")[1] +
              " | " +
              shuffledArray[i].name.split("-")[0];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: (trackName.innerHTML = tags.title
            ? tags.title
            : shuffledArray[i].name.split("-")[1]),
          artist: (trackArtist.innerHTML = tags.artist
            ? tags.artist
            : shuffledArray[i].name.split("-")[0]),
          album: (trackAlbum.innerHTML = tags.album
            ? tags.album
            : shuffledArray[i].name.split("-")[1]),
        });
      },
      onError: function () {
        trackArt.src = "./assets/images/default-icon.jpg";
        bgArtwork.style.backgroundImage =
          "url('./assets/images/default-icon.jpg')";
        document.title =
          shuffledArray[i].name.split("-")[1] +
          " | " +
          shuffledArray[i].name.split("-")[0];
        trackName.innerHTML = shuffledArray[i].name.split("-")[1];
        trackArtist.innerHTML = shuffledArray[i].name.split("-")[0];
        trackAlbum.innerHTML = shuffledArray[i].name.split("-")[1];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: shuffledArray[i].name.split("-")[1],
          artist: shuffledArray[i].name.split("-")[0],
          album: shuffledArray[i].name.split("-")[1],
        });
      },
    });
  }

  function highlightPlaylist(i) {
    document.querySelectorAll(".tbody-playlist").forEach(function (el, idx) {
      el.classList.toggle("active", idx === i);
    });
  }

  function renderPlaylist() {
    var tbody = document.querySelector(".tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    shuffledArray.forEach(function (item, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><div class="tbody-playlist" data-index="' +
        i +
        '"><div class="tp-img"><img src="./assets/images/default-icon.jpg" alt=""><div class="playing-indicator"><span class="material-symbols-rounded icon-play">play_arrow</span><span class="material-symbols-rounded icon-pause">pause</span></div></div><div class="tp-info"><div class="tp-title">' +
        item.name.split("-")[1] +
        '</div><div class="tp-artist">' +
        item.name.split("-")[0] +
        '</div><div class="tp-album">' +
        item.name.split("-")[1] +
        "</div></div></div></td>";
      tbody.appendChild(tr);
      readMeta(i).then(function (meta) {
        var el = tbody.querySelector('[data-index="' + i + '"]');
        if (!el) return;
        var imgEl = el.querySelector(".tp-img img");
        var titleEl = el.querySelector(".tp-title");
        var artistEl = el.querySelector(".tp-artist");
        var albumEl = el.querySelector(".tp-album");
        if (meta.picture) {
          imgEl.src = base64FromPicture(meta.picture);
        } else {
          imgEl.src = "./assets/images/default-icon.jpg";
        }
        titleEl.textContent = meta.title;
        artistEl.textContent = meta.artist;
        albumEl.textContent = meta.album;
      });
    });
    tbody.addEventListener("click", function (e) {
      var item = e.target.closest(".tbody-playlist");
      if (!item) return;
      var idx = Number(item.getAttribute("data-index"));
      if (idx === index) {
        if (wavesurfer.isPlaying()) {
          wavesurfer.pause();
        } else {
          wavesurfer.play();
        }
      } else {
        loadTrack(idx);
        document.querySelector(".sidebar").classList.remove("active");
      }
    });
  }

  renderPlaylist();

  wavesurfer.on("error", function (e) {
    console.log(e);
  });
});

window.onload = function () {
  document.addEventListener(
    "contextmenu",
    function (e) {
      e.preventDefault();
    },
    false
  );
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.ctrlKey && e.shiftKey && e.keyCode == 73) {
        disabledEvent(e);
      }
      if (e.ctrlKey && e.shiftKey && e.keyCode == 74) {
        disabledEvent(e);
      }
      if (
        e.keyCode == 83 &&
        (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey)
      ) {
        disabledEvent(e);
      }
      if (e.ctrlKey && e.keyCode == 85) {
        disabledEvent(e);
      }
      if (e.keyCode == 123) {
        disabledEvent(e);
      }
    },
    false
  );

  function disabledEvent(e) {
    if (e.stopPropagation) {
      e.stopPropagation();
    } else if (window.event) {
      window.event.cancelBubble = true;
    }
    e.preventDefault();
    return false;
  }
};
