/* ============================================================
 * YTGrab Web — 100% automático.
 * O site se conecta sozinho a servidores públicos gratuitos
 * (Piped e Invidious) com fallback: um falhou, tenta o próximo.
 * Nenhuma configuração é necessária.
 * ============================================================ */

const I18N = {
  pt: {
    tagline: "Baixe vídeos e músicas do YouTube",
    getInfo: "Buscar",
    download: "Baixar",
    downloading: "Baixando",
    tabVideo: "Vídeo",
    tabAudio: "Áudio",
    quality: "Qualidade:",
    audioFormat: "Formato:",
    settings: "Configurações",
    language: "Idioma",
    theme: "Tema",
    themeDark: "Escuro",
    themeLight: "Claro",
    reconnect: "Reconectar",
    close: "Fechar",
    madeBy: "Feito por",
    urlPlaceholder: "Cole o link do YouTube aqui...",
    invalidUrl: "Link do YouTube inválido.",
    connecting: "conectando…",
    connected: "conectado",
    noServer: "nenhum servidor respondeu — clique para tentar de novo",
    switching: "servidor instável, trocando…",
    fetching: "Buscando informações do vídeo...",
    noFormats: "Nenhuma qualidade disponível nesse vídeo.",
    downloadStarted: "Download iniciado!",
    done: "Download concluído! Confira a pasta de downloads. ✅",
    openedNewTab: "Abri o arquivo em nova aba — use Ctrl+S para salvar.",
    errFetch: "Não consegui buscar esse vídeo (o servidor pode estar sobrecarregado). Tente de novo.",
    errServer: "Todos os servidores públicos estão ocupados agora 😴 — tente novamente em alguns instantes.",
    currentServer: "Servidor atual:",
    bestQuality: "Máxima",
  },
  en: {
    tagline: "Download YouTube videos and music",
    getInfo: "Search",
    download: "Download",
    downloading: "Downloading",
    tabVideo: "Video",
    tabAudio: "Audio",
    quality: "Quality:",
    audioFormat: "Format:",
    settings: "Settings",
    language: "Language",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    reconnect: "Reconnect",
    close: "Close",
    madeBy: "Made by",
    urlPlaceholder: "Paste the YouTube link here...",
    invalidUrl: "Invalid YouTube link.",
    connecting: "connecting…",
    connected: "connected",
    noServer: "no server responded — click to retry",
    switching: "unstable server, switching…",
    fetching: "Fetching video info...",
    noFormats: "No quality available for this video.",
    downloadStarted: "Download started!",
    done: "Download complete! Check your downloads folder. ✅",
    openedNewTab: "Opened the file in a new tab — press Ctrl+S to save.",
    errFetch: "Could not fetch this video (server may be busy). Please retry.",
    errServer: "All public servers are busy right now 😴 — try again in a few moments.",
    currentServer: "Current server:",
    bestQuality: "Best",
  },
};

/* Candidatos hardcoded (testados) — a ordem é a prioridade do fallback */
const STATIC_CANDIDATES = [
  { engine: "piped", base: "https://api.piped.private.coffee" },
  { engine: "piped", base: "https://pipedapi.ducks.party" },
  { engine: "piped", base: "https://pipedapi.darkness.services" },
  { engine: "piped", base: "https://piped-api.codespace.cz" },
  { engine: "piped", base: "https://pipedapi.kavin.rocks" },
  { engine: "piped", base: "https://pipedapi.leptons.xyz" },
  { engine: "piped", base: "https://pipedapi.reallyaweso.me" },
  { engine: "piped", base: "https://pipedapi.orangenet.cc" },
  { engine: "piped", base: "https://pipedapi.adminforge.de" },
  { engine: "piped", base: "https://api.piped.yt" },
  { engine: "piped", base: "https://pipedapi.drgns.space" },
  { engine: "piped", base: "https://pipedapi.owo.si" },
  { engine: "piped", base: "https://piped-api.privacy.com.de" },
  { engine: "piped", base: "https://pipedapi.nosebs.ru" },
  { engine: "piped", base: "https://pipedapi-libre.kavin.rocks" },
  { engine: "invidious", base: "https://inv.nadeko.net" },
  { engine: "invidious", base: "https://invidious.f5.si" },
  { engine: "invidious", base: "https://invidious.nerdvpn.de" },
  { engine: "invidious", base: "https://yt.chocolatemoo53.com" },
  { engine: "invidious", base: "https://invidious.tiekoetter.com" },
];

/* Listas dinâmicas: mantêm o site atualizado sem novo deploy */
const DYNAMIC_SOURCES = [
  {
    url: "https://piped-instances.kavin.rocks/",
    parse: (d) => (Array.isArray(d) ? d : []).map((i) => ({ engine: "piped", base: (i.api_url || "").replace(/\/+$/, "") })).filter((i) => i.base),
  },
  {
    url: "https://api.invidious.io/instances.json?sort_by=health",
    parse: (d) =>
      (Array.isArray(d) ? d : [])
        .map((x) => (Array.isArray(x) ? { name: x[0], info: x[1] } : null))
        .filter((x) => x && (x.info || {}).uri && /^https:\/\/[^/]+$/.test(x.info.uri))
        .filter((x) => !/\.(onion|i2p|ygg)$/.test(x.name))
        .map((x) => ({ engine: "invidious", base: x.info.uri })),
  },
];

const TEST_VIDEO = "jNQXAC9IVRw"; // "Me at the zoo" — leve e eterno

const $ = (id) => document.getElementById(id);

const state = {
  lang: localStorage.getItem("ytgrabweb_lang") || "pt",
  theme: localStorage.getItem("ytgrabweb_theme") || "dark",
  candidates: [],
  idx: -1, // índice do servidor ativo
  info: null, // { title, duration, thumbnail, videos: [], audios: [] }
  videoId: "",
  mode: "video",
  busy: false,
  connecting: null, // Promise ativa de conexão
};

function t(key) { return I18N[state.lang][key] ?? key; }
function active() { return state.idx >= 0 ? state.candidates[state.idx] : null; }

function setChip(cls, text) {
  const chip = $("connChip");
  chip.className = "chip" + (cls ? " " + cls : "");
  $("connText").textContent = text;
}

/* ------------------------------ Conexão ------------------------------ */

function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function testCandidate(c) {
  try {
    const url =
      c.engine === "piped"
        ? `${c.base}/streams/${TEST_VIDEO}`
        : `${c.base}/api/v1/videos/${TEST_VIDEO}?fields=title`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return false;
    const j = await res.json();
    return Boolean(j.title);
  } catch {
    return false;
  }
}

async function buildCandidateList() {
  const list = [...STATIC_CANDIDATES];
  const seen = new Set(list.map((c) => c.base));
  // Listas dinâmicas em paralelo, sem travar a inicialização
  const dyn = await Promise.allSettled(
    DYNAMIC_SOURCES.map(async (src) => {
      const res = await fetchWithTimeout(src.url, {}, 6000);
      if (!res.ok) return [];
      return src.parse(await res.json());
    })
  );
  for (const r of dyn) {
    if (r.status !== "fulfilled") continue;
    for (const c of r.value) {
      if (!seen.has(c.base)) {
        seen.add(c.base);
        list.push(c);
      }
    }
  }
  return list;
}

async function connect(force = false) {
  if (state.connecting && !force) return state.connecting;
  state.connecting = (async () => {
    setChip("", t("connecting"));
    if (!state.candidates.length || force) {
      state.candidates = await buildCandidateList();
    }
    // Testa em lotes de 3: o primeiro que responder ganha
    for (let i = 0; i < state.candidates.length; i += 3) {
      const batch = state.candidates.slice(i, i + 3);
      const results = await Promise.all(batch.map(testCandidate));
      const hit = results.indexOf(true);
      if (hit !== -1) {
        state.idx = i + hit;
        setChip("ok", `${t("connected")} · ${shortHost(active().base)}`);
        updateServerInfo();
        return true;
      }
    }
    state.idx = -1;
    setChip("err", t("noServer"));
    updateServerInfo();
    return false;
  })();
  try {
    return await state.connecting;
  } finally {
    state.connecting = null;
  }
}

/* Avança para o próximo servidor da lista (fallback automático) */
async function nextServer() {
  const start = state.idx;
  setChip("", t("switching"));
  for (let i = start + 1; i < state.candidates.length; i++) {
    if (await testCandidate(state.candidates[i])) {
      state.idx = i;
      setChip("ok", `${t("connected")} · ${shortHost(active().base)}`);
      updateServerInfo();
      return true;
    }
  }
  // Deu a volta e ninguém respondeu: tenta reconectar do zero
  state.idx = -1;
  return connect(true);
}

function shortHost(base) {
  return base.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function updateServerInfo() {
  const a = active();
  $("serverInfo").textContent = `${t("currentServer")} ${a ? shortHost(a.base) : "—"}`;
}

/* ------------------------------ Extração ------------------------------ */

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function sanitizeFilename(name) {
  return (name || "ytgrab").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

async function getInfoPiped(base, id) {
  const res = await fetchWithTimeout(`${base}/streams/${id}`, {}, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error);

  const videos = (d.videoStreams || [])
    .filter((v) => v.url && v.videoOnly === false) // com áudio junto
    .map((v) => ({
      label: v.quality || "?",
      url: v.url,
      ext: (v.mimeType || "").includes("webm") ? "webm" : "mp4",
    }));
  const seen = new Set();
  const uniqVideos = videos.filter((v) => (seen.has(v.label) ? false : seen.add(v.label)));

  const audios = (d.audioStreams || [])
    .filter((a) => a.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    .map((a) => ({
      label: `${(a.mimeType || "").includes("mp4") ? "M4A" : "OPUS"}${a.bitrate ? " · " + Math.round(a.bitrate / 1000) + " kbps" : ""}`,
      url: a.url,
      ext: (a.mimeType || "").includes("mp4") ? "m4a" : "opus",
    }));

  return {
    title: d.title || "",
    duration: d.duration || 0,
    thumbnail: d.thumbnailUrl || "",
    videos: uniqVideos,
    audios,
  };
}

async function getInfoInvidious(base, id) {
  const res = await fetchWithTimeout(
    `${base}/api/v1/videos/${id}?local=true&fields=title,lengthSeconds,thumbnails,format_streams,adaptiveFormats`,
    {},
    15000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();

  const videos = (d.format_streams || [])
    .filter((f) => f.url)
    .map((f) => ({
      label: `${f.qualityLabel || "?"} · ${(f.container || "mp4").toUpperCase()}`,
      url: f.url,
      ext: (f.container || "mp4").toLowerCase(),
    }));

  const audios = (d.adaptiveFormats || [])
    .filter((f) => f.url && (f.type || "").startsWith("audio/"))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    .slice(0, 6)
    .map((f) => ({
      label: `${(f.type || "").includes("mp4") ? "M4A" : "OPUS"}${f.bitrate ? " · " + Math.round(f.bitrate / 1000) + " kbps" : ""}`,
      url: f.url,
      ext: (f.type || "").includes("mp4") ? "m4a" : "webm",
    }));

  const thumbs = d.thumbnails || [];
  return {
    title: d.title || "",
    duration: d.lengthSeconds || 0,
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : "",
    videos,
    audios,
  };
}

async function getInfo(id) {
  const a = active();
  if (!a) throw new Error("no-server");
  return a.engine === "piped" ? getInfoPiped(a.base, id) : getInfoInvidious(a.base, id);
}

/* ------------------------------ Interface ----------------------------- */

function setStatus(msg, cls = "") {
  const el = $("statusMsg");
  el.textContent = msg;
  el.className = "status " + cls;
}

function fillOptions() {
  const vq = $("videoQuality");
  vq.innerHTML = "";
  state.info.videos.forEach((v, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = v.label;
    vq.appendChild(o);
  });

  const af = $("audioFormat");
  af.innerHTML = "";
  state.info.audios.forEach((a, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = a.label;
    af.appendChild(o);
  });

  const hasVideo = state.info.videos.length > 0;
  const hasAudio = state.info.audios.length > 0;
  if (!hasVideo && hasAudio) {
    $("tabVideo").disabled = true;
    $("tabAudio").click();
  } else if (!hasAudio && hasVideo) {
    $("tabAudio").disabled = true;
  } else if (hasVideo) {
    $("tabVideo").disabled = false;
    $("tabAudio").disabled = false;
  }
}

async function blobDownload(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      $("progressFill").style.width = pct + "%";
      $("progressText").textContent = `${t("downloading")}... ${pct}%`;
    } else {
      $("progressText").textContent = `${t("downloading")}... ${(received / 1048576).toFixed(1)} MB`;
    }
  }
  const blob = new Blob(chunks);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function saveFile(url, filename) {
  $("progressWrap").classList.remove("hidden");
  $("progressFill").style.width = "4%";
  $("progressText").textContent = `${t("downloading")}...`;
  try {
    await blobDownload(url, filename);
    $("progressFill").style.width = "100%";
    setStatus(t("done"), "ok");
  } catch {
    window.open(url, "_blank", "noopener");
    setStatus(t("openedNewTab"), "ok");
  } finally {
    setTimeout(() => $("progressWrap").classList.add("hidden"), 1500);
  }
}

/* ------------------------------- Ações -------------------------------- */

async function doFetch() {
  if (state.busy) return;
  const url = $("urlInput").value.trim();
  const id = extractVideoId(url);
  if (!id) return setStatus(t("invalidUrl"), "err");

  state.busy = true;
  $("btnFetch").disabled = true;
  setStatus(t("fetching"));

  try {
    if (!active()) {
      const ok = await connect();
      if (!ok) throw new Error("no-server");
    }

    let info;
    try {
      info = await getInfo(id);
    } catch (e) {
      // fallback automático: troca de servidor e tenta de novo
      if (e.message === "no-server") throw e;
      const switched = await nextServer();
      if (!switched) throw new Error("no-server");
      info = await getInfo(id);
    }

    if (!info.videos.length && !info.audios.length) {
      setStatus(t("noFormats"), "err");
      return;
    }

    state.videoId = id;
    state.info = info;
    $("thumb").src = info.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    $("videoTitle").textContent = info.title;
    $("videoDuration").textContent = info.duration ? fmtDuration(info.duration) : "";
    fillOptions();
    $("result").classList.remove("hidden");
    setStatus("");
  } catch (e) {
    setStatus(e.message === "no-server" ? t("errServer") : t("errFetch"), "err");
    console.error(e);
  } finally {
    state.busy = false;
    $("btnFetch").disabled = false;
  }
}

async function doDownload() {
  if (state.busy || !state.info) return;
  state.busy = true;
  $("btnDownload").disabled = true;
  setStatus("");
  try {
    const item =
      state.mode === "video"
        ? state.info.videos[parseInt($("videoQuality").value, 10)]
        : state.info.audios[parseInt($("audioFormat").value, 10)];
    if (!item) throw new Error("no-format");
    await saveFile(item.url, `${sanitizeFilename(state.info.title)}.${item.ext}`);
  } catch (e) {
    setStatus(t("errFetch"), "err");
    console.error(e);
  } finally {
    state.busy = false;
    $("btnDownload").disabled = false;
  }
}

/* -------------------------------- i18n -------------------------------- */

function applyI18n() {
  document.documentElement.lang = state.lang === "pt" ? "pt-BR" : "en";
  $("tagline").textContent = t("tagline");
  $("urlInput").placeholder = t("urlPlaceholder");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $("langSelect").value = state.lang;
  $("themeSelect").value = state.theme;
  updateServerInfo();
  const chip = $("connChip");
  if (chip.classList.contains("ok") && active()) setChip("ok", `${t("connected")} · ${shortHost(active().base)}`);
  else if (chip.classList.contains("err")) setChip("err", t("noServer"));
  else setChip("", t("connecting"));
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("btnTheme").textContent = state.theme === "dark" ? "🌙" : "☀️";
}

/* -------------------------------- Init -------------------------------- */

function init() {
  applyTheme();
  applyI18n();

  $("btnTheme").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("ytgrabweb_theme", state.theme);
    applyTheme();
    $("themeSelect").value = state.theme;
  };
  $("btnLang").onclick = () => {
    state.lang = state.lang === "pt" ? "en" : "pt";
    localStorage.setItem("ytgrabweb_lang", state.lang);
    applyI18n();
  };
  $("langSelect").onchange = (e) => {
    state.lang = e.target.value;
    localStorage.setItem("ytgrabweb_lang", state.lang);
    applyI18n();
  };
  $("themeSelect").onchange = (e) => {
    state.theme = e.target.value;
    localStorage.setItem("ytgrabweb_theme", state.theme);
    applyTheme();
  };

  $("btnSettings").onclick = () => $("settingsModal").classList.remove("hidden");
  $("btnCloseSettings").onclick = () => $("settingsModal").classList.add("hidden");
  $("settingsModal").onclick = (e) => {
    if (e.target === $("settingsModal")) $("settingsModal").classList.add("hidden");
  };
  $("btnReconnect").onclick = () => connect(true);
  $("connChip").onclick = () => {
    if (!active()) connect(true);
  };

  $("btnFetch").onclick = doFetch;
  $("urlInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doFetch();
  });
  $("btnDownload").onclick = doDownload;

  $("tabVideo").onclick = () => {
    state.mode = "video";
    $("tabVideo").classList.add("active");
    $("tabAudio").classList.remove("active");
    $("videoControls").classList.remove("hidden");
    $("audioControls").classList.add("hidden");
  };
  $("tabAudio").onclick = () => {
    state.mode = "audio";
    $("tabAudio").classList.add("active");
    $("tabVideo").classList.remove("active");
    $("audioControls").classList.remove("hidden");
    $("videoControls").classList.add("hidden");
  };

  connect(); // conecta sozinho, na hora que o site abre
}

init();
