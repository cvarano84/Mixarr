const state = {
  baseUrl: "",
  token: "",
  jobId: "",
  synced: false,
  tokenConfigured: false
};

const $ = selector => document.querySelector(selector);

const elements = {
  navLinks: document.querySelectorAll("[data-route]"),
  pages: document.querySelectorAll("[data-page]"),
  connectForm: $("#connectForm"),
  plexUrl: $("#plexUrl"),
  plexToken: $("#plexToken"),
  connectionStatus: $("#connectionStatus"),
  librarySelect: $("#librarySelect"),
  syncButton: $("#syncButton"),
  syncMessage: $("#syncMessage"),
  syncPercent: $("#syncPercent"),
  progressBar: $("#progressBar"),
  genreSelect: $("#genreSelect"),
  decadeSelect: $("#decadeSelect"),
  playlistName: $("#playlistName"),
  minPlays: $("#minPlays"),
  maxTracks: $("#maxTracks"),
  popularOnly: $("#popularOnly"),
  popularityProvider: $("#popularityProvider"),
  lastfmApiKey: $("#lastfmApiKey"),
  spotifyClientId: $("#spotifyClientId"),
  spotifyClientSecret: $("#spotifyClientSecret"),
  testProviderButton: $("#testProviderButton"),
  providerStatus: $("#providerStatus"),
  lastfmCredential: $(".provider-lastfm"),
  spotifyCredential: $(".provider-spotify"),
  previewButton: $("#previewButton"),
  createButton: $("#createButton"),
  summaryText: $("#summaryText"),
  libraryCardText: $("#libraryCardText"),
  playlistCardText: $("#playlistCardText"),
  trackMetric: $("#trackMetric"),
  genreMetric: $("#genreMetric"),
  decadeMetric: $("#decadeMetric"),
  trackTable: $("#trackTable"),
  toast: $("#toast")
};

const pageTitles = {
  dashboard: "PlexMix",
  library: "PlexMix - Library",
  builder: "PlexMix - Build Playlist",
  playlist: "PlexMix - Playlist",
  settings: "PlexMix - Settings"
};

function currentRoute() {
  const route = window.location.hash.replace("#", "") || "dashboard";
  return pageTitles[route] ? route : "dashboard";
}

function showRoute(route = currentRoute()) {
  elements.pages.forEach(page => {
    page.classList.toggle("active", page.dataset.page === route);
  });
  elements.navLinks.forEach(link => {
    const active = link.dataset.route === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = pageTitles[route] || pageTitles.dashboard;
  window.scrollTo({ top: 0, behavior: "auto" });
}

window.addEventListener("hashchange", () => showRoute());
showRoute();

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3800);
}

function populateLibraries(libraries = [], selectedKey = "") {
  elements.librarySelect.innerHTML = "";
  libraries.forEach(library => {
    const option = document.createElement("option");
    option.value = library.key;
    option.textContent = library.title;
    option.selected = library.key === selectedKey;
    elements.librarySelect.append(option);
  });

  if (!libraries.length) {
    elements.librarySelect.innerHTML = '<option value="">Connect to load libraries</option>';
    elements.librarySelect.disabled = true;
    elements.syncButton.disabled = true;
    return;
  }

  elements.librarySelect.disabled = false;
  elements.syncButton.disabled = false;
  elements.libraryCardText.textContent = `${libraries.length} music librar${libraries.length === 1 ? "y" : "ies"} saved`;
}

async function loadConfig() {
  try {
    const config = await api("/api/config");
    state.baseUrl = config.baseUrl || "";
    state.tokenConfigured = config.tokenConfigured;
    state.jobId = config.jobId || "";
    state.synced = Boolean(config.jobId && config.summary);

    if (config.baseUrl) elements.plexUrl.value = config.baseUrl;
    if (config.tokenConfigured) {
      elements.plexToken.required = false;
      elements.plexToken.placeholder = "Configured by Docker environment";
      elements.connectionStatus.textContent = config.baseUrl ? "Configured" : "Token configured";
    }

    if (config.defaultProvider) {
      elements.popularityProvider.value = config.defaultProvider;
      elements.popularityProvider.dispatchEvent(new Event("change"));
    }

    populateLibraries(config.libraries || [], config.sectionKey || "");
    if (config.summary) {
      enableBuilder(config.summary);
      elements.libraryCardText.textContent = `${config.summary.total} tracks saved`;
    }
    if (config.playlists?.length) {
      const latest = config.playlists[0];
      elements.playlistCardText.textContent = `${latest.count} tracks in "${latest.title}"`;
    }
  } catch (error) {
    console.warn(error);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function selectedValues(select) {
  return [...select.selectedOptions].map(option => option.value);
}

function currentFilters() {
  return {
    genres: selectedValues(elements.genreSelect),
    decades: selectedValues(elements.decadeSelect),
    minPlays: Number(elements.minPlays.value || 0),
    maxTracks: Number(elements.maxTracks.value || 75),
    popularOnly: elements.popularOnly.checked,
    popularityProvider: elements.popularityProvider.value || "deezer"
  };
}

function currentProviderCredentials() {
  return {
    lastfmApiKey: elements.lastfmApiKey.value.trim(),
    spotifyClientId: elements.spotifyClientId.value.trim(),
    spotifyClientSecret: elements.spotifyClientSecret.value.trim()
  };
}

function setProgress(progress, message) {
  elements.progressBar.style.width = `${progress}%`;
  elements.syncPercent.textContent = `${progress}%`;
  elements.syncMessage.textContent = message;
}

function setOptions(select, items, formatter, emptyLabel) {
  select.innerHTML = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    option.disabled = true;
    select.append(option);
    return;
  }
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = formatter(item);
    select.append(option);
  });
}

function enableBuilder(summary) {
  elements.genreSelect.disabled = false;
  elements.decadeSelect.disabled = false;
  elements.previewButton.disabled = false;
  elements.createButton.disabled = false;
  elements.trackMetric.textContent = summary.total;
  elements.genreMetric.textContent = summary.genres.length;
  elements.decadeMetric.textContent = summary.decades.length;
  elements.summaryText.textContent = `${summary.total} tracks synced. Pick filters and preview the playlist before creating it in Plex.`;
  setOptions(elements.genreSelect, summary.genres, item => `${item.name} (${item.count})`, "No genres found");
  setOptions(elements.decadeSelect, summary.decades, item => `${item.name}s (${item.count})`, "No dated tracks found");
}

function renderTracks(tracks) {
  if (!tracks.length) {
    elements.trackTable.innerHTML = '<tr><td colspan="6" class="empty-state">No tracks matched those filters.</td></tr>';
    return;
  }

  elements.trackTable.innerHTML = tracks.map(track => `
    <tr>
      <td>${escapeHtml(track.title)}</td>
      <td>${escapeHtml(track.artist)}</td>
      <td>${escapeHtml(track.album)}</td>
      <td>${track.year || ""}</td>
      <td>${track.playCount}</td>
      <td>${escapeHtml(track.popularity?.label || "Local plays")}</td>
    </tr>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

elements.connectForm.addEventListener("submit", async event => {
  event.preventDefault();
  state.baseUrl = elements.plexUrl.value.trim();
  state.token = elements.plexToken.value.trim();
  elements.connectionStatus.textContent = "Connecting";

  try {
    const payload = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ baseUrl: state.baseUrl, token: state.token })
    });

    if (!payload.libraries.length) {
      populateLibraries([]);
      elements.librarySelect.innerHTML = '<option value="">No music libraries found</option>';
      elements.syncButton.disabled = true;
      toast("Connected, but no Plex music libraries were found.", true);
    } else {
      populateLibraries(payload.libraries, payload.config?.sectionKey || "");
      elements.libraryCardText.textContent = `${payload.libraries.length} music librar${payload.libraries.length === 1 ? "y" : "ies"} found`;
      toast(`Connected to Plex. Found ${payload.libraries.length} music library option${payload.libraries.length === 1 ? "" : "s"}.`);
    }
    elements.connectionStatus.textContent = "Connected";
  } catch (error) {
    elements.connectionStatus.textContent = "Disconnected";
    toast(error.message, true);
  }
});

elements.syncButton.addEventListener("click", async () => {
  const sectionKey = elements.librarySelect.value;
  if (!sectionKey) return;

  elements.syncButton.disabled = true;
  state.synced = false;
  setProgress(1, "Starting sync");

  try {
    const payload = await api("/api/sync", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: state.baseUrl,
        token: state.token,
        sectionKey
      })
    });
    state.jobId = payload.jobId;
    watchSync(payload.jobId);
  } catch (error) {
    elements.syncButton.disabled = false;
    toast(error.message, true);
  }
});

elements.popularityProvider.addEventListener("change", () => {
  const provider = elements.popularityProvider.value;
  elements.lastfmCredential.hidden = provider !== "lastfm";
  elements.spotifyCredential.hidden = provider !== "spotify";
  elements.providerStatus.textContent = "No provider tested yet.";
});

elements.testProviderButton.addEventListener("click", async () => {
  const provider = elements.popularityProvider.value;
  elements.testProviderButton.disabled = true;
  elements.providerStatus.textContent = "Testing provider...";

  try {
    const payload = await api("/api/providers/test", {
      method: "POST",
      body: JSON.stringify({
        provider,
        credentials: currentProviderCredentials()
      })
    });
    elements.providerStatus.textContent = payload.message;
    toast(`${providerLabel(provider)} test passed.`);
  } catch (error) {
    elements.providerStatus.textContent = error.message;
    toast(error.message, true);
  } finally {
    elements.testProviderButton.disabled = false;
  }
});

function providerLabel(provider) {
  return {
    deezer: "Deezer",
    lastfm: "Last.fm",
    spotify: "Spotify",
    plex: "Plex"
  }[provider] || provider;
}

function watchSync(jobId) {
  const events = new EventSource(`/api/sync/${encodeURIComponent(jobId)}/events`);
  events.onmessage = event => {
    const job = JSON.parse(event.data);
    setProgress(job.progress, job.message);

    if (job.status === "complete") {
      events.close();
      state.synced = true;
      elements.syncButton.disabled = false;
      enableBuilder(job.summary);
      elements.libraryCardText.textContent = `${job.summary.total} tracks synced`;
      toast("Library sync complete.");
    }

    if (job.status === "error") {
      events.close();
      elements.syncButton.disabled = false;
      toast(job.error || "Sync failed.", true);
    }
  };
  events.onerror = () => {
    events.close();
    elements.syncButton.disabled = false;
    toast("Lost the sync progress connection.", true);
  };
}

elements.previewButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify({
        jobId: state.jobId,
        filters: currentFilters(),
        credentials: currentProviderCredentials()
      })
    });
    renderTracks(payload.tracks);
    elements.summaryText.textContent = `${payload.count} tracks match the current filters.`;
    window.location.hash = "playlist";
  } catch (error) {
    toast(error.message, true);
  }
});

elements.createButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/playlists", {
      method: "POST",
      body: JSON.stringify({
        jobId: state.jobId,
        title: elements.playlistName.value,
        filters: currentFilters(),
        credentials: currentProviderCredentials()
      })
    });
    toast(`Created "${payload.title}" with ${payload.count} tracks in Plex.`);
    elements.playlistCardText.textContent = `${payload.count} tracks in latest playlist`;
    window.location.hash = "playlist";
  } catch (error) {
    toast(error.message, true);
  }
});

loadConfig();
