/* ============================================================
 * YTGrab Web v3 — arquitetura definitiva:
 *
 * 1. METADADOS (título/capa) vêm do oEmbed do próprio YouTube
 *    (CORS aberto, sem servidor) — a interface nunca fica cega.
 * 2. DOWNLOAD usa uma cadeia de servidores com fallback total:
 *      a) servidores do projeto  -> site/backend (servers.json)
 *      b) instâncias públicas Piped/Invidious (vídeos populares
 *         costumam estar em cache e baixam mesmo com o YouTube
 *         bloqueando IPs de datacenter)
 *    Um falhou? Tenta o próximo automaticamente, sem o usuário
 *    configurar NADA.
 * 3. servers.json é lido do repositório (gh-pages) — dá pra
 *    adicionar/trocar servidor sem redeployar o site.
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
    reconnect: "Reconectar",
    close: "Fechar",
    madeBy: "Feito por",
    urlPlaceholder: "Cole o link do YouTube aqui...",
    invalidUrl: "Link do YouTube inválido.",
    connecting: "conectando…",
    connected: "conectado",
    noServer: "sem servidores — clique p/ tentar de novo",
    trying: "tentando servidores",
    fetching: "Buscando informações do vídeo...",
    noFormats: "Nenhuma qualidade disponível nesse vídeo.",
    done: "Download concluído! Confira a pasta de downloads. ✅",
    openedNewTab: "Abri o arquivo em nova aba — use Ctrl+S para salvar.",
    errFetch: "Nenhum servidor conseguiu esse vídeo agora 😴 — os públicos costumam voltar em alguns minutos. Tente de novo!",
    currentServer: "Servidor atual:",
    bestQuality: "🏆 Máxima",
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
    reconnect: "Reconnect",
    close: "Close",
    madeBy: "Made by",
    urlPlaceholder: "Paste the YouTube link here...",
    invalidUrl: "Invalid YouTube link.",
    connecting: "connecting…",
    connected: "connected",
    noServer: "no servers — click to retry",
    trying: "trying servers",
    fetching: "Fetching video info...",
    noFormats: "No quality available for this video.",
    done: "Download complete! Check your downloads folder. ✅",
    openedNewTab: "Opened the file in a new tab — press Ctrl+S to save.",
    errFetch: "No server could fetch this video right now 😴 — public ones usually recover in a few minutes. Please retry!",
    currentServer: "Current server:",
    bestQuality: "🏆 Best",
  },
};

/* Lista dinâmica de servidores do projeto (editável sem redeploy) */
const SERVERS_JSON =
  "https://raw.githubusercontent.com/MicaelSanPedro/ytgrab/gh-pages/servers.json";

/* Candidatos estáticos — ordem = prioridade */
const STATIC_CANDIDATES = [
  { engine: "piped", base: "https://api.piped.private.coffee" },
  { engine: "piped", base: "https://pipedapi.ducks.party" },
  { engine: "piped", base: "https://pipedapi.darkness.services" },
  { engine: "piped", base: "https://piped-api.codespace.cz" },
  { engine: "piped", base: "https://pipedapi.kavin.rocks" },
  { engine: "piped", base: "https://pipedapi.leptons.xyz" },
  { engine: "piped", base: "https://pipedapi.reallyaweso.me" },
  { engine: "piped", base: "https://pipedapi.orangenet.cc" },
  { engine: "invidious", base: "https://inv.nadeko.net" },
  { engine: "invidious", base: "https://invidious.f5.si" },
  { engine: "invidious", base: "https://invidious.nerdvpn.de" },
];

const DYNAMIC_SOURCES = [
  {
    url: "https://piped-instances.kavin.rocks/",
    parse: (d) =>
      (Array.isArray(d) ? d : [])
        .map((i) => ({ engine: "piped", base: (i.api_url || "").replace(/\/+$/, "") }))
        .filter((i) => i.base),
  },
];

/* Qualidades/áudios quando o servidor ativo é Cobalt (não lista formatos) */
const COBALT_VIDEOS = [
  ["max", null], ["2160", "4K · 2160p"], ["1440", "1440p"],
  ["1080", "Full HD · 1080p"], ["720", "HD · 720p"], ["480", "480p"], ["360", "360p"],
];
const COBALT_AUDIOS = [
  { fmt: "mp3", br: "320", label: "MP3 · 320 kbps", ext: "mp3" },
  { fmt: "mp3", br: "256", label: "MP3 · 256 kbps", ext: "mp3" },
  { fmt: "mp3", br: "128", label: "MP3 · 128 kbps", ext: "mp3" },
  { fmt: "opus", br: "128", label: "OPUS · 128 kbps", ext: "opus" },
  { fmt: "opus", br: "96", label: "OPUS · 96 kbps", ext: "opus" },
];

const TEST_VIDEO = "jNQXAC9IVRw";

const $ = (id) => document.getElementById(id);

const state = {
  lang: localStorage.getItem("ytgrabweb_lang") || "pt",
  theme: localStorage.getItem("ytgrabweb_theme") || "dark",
  candidates: [],
  idx: -1,
  info: null,
  videoId: "",
  mode: "video",
  busy: false,
  connecting: null,
};

function t(key) { return I18N[state.lang][key] ?? key; }
function active() { return state.idx >= 0 ? state.candidates[state.idx] : null; }
function shortHost(base) { return base.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }

function setChip(cls, text) {
  $("connChip").className = "chip" + (cls ? " " + cls : "");
  $("connText").textContent = text;
}

function setStatus(msg, cls = "") {
  const el = $("statusMsg");
  el.textContent = msg;
  el.className = "status " + cls;
}

function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/* ------------------------- Motores de download ------------------------- */

async function testCandidate(c, ms = 8000) {
  try {
    if (c.engine === "cobalt") {
      const res = await fetchWithTimeout(`${c.base}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${TEST_VIDEO}`, downloadMode: "audio", audioFormat: "mp3" }),
      }, ms);
      const j = await res.json().catch(() => ({}));
      return ["tunnel", "redirect", "stream", "local", "picker"].includes(j.status);
    }
    const url =
      c.engine === "piped"
        ? `${c.base}/streams/${TEST_VIDEO}`
        : `${c.base}/api/v1/videos/${TEST_VIDEO}?fields=title`;
    const res = await fetchWithTimeout(url, {}, ms);
    if (!res.ok) return false;
    const j = await res.json();
    return Boolean(j.title);
  } catch {
    return false;
  }
}

async function oEmbed(id) {
  // YouTube oEmbed tem CORS aberto; noembed.com é o plano B
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, {}, 6000
    );
    if (res.ok) {
      const j = await res.json();
      if (j.title) return { title: j.title, thumbnail: j.thumbnail_url || "" };
    }
  } catch { /* segue */ }
  try {
    const res = await fetchWithTimeout(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`, {}, 6000);
    if (res.ok) {
      const j = await res.json();
      if (j.title) return { title: j.title, thumbnail: j.thumbnail_url || "" };
    }
  } catch { /* segue */ }
  return { title: "", thumbnail: "" };
}

async function getInfoPiped(base, id) {
  const res = await fetchWithTimeout(`${base}/streams/${id}`, {}, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (d.error) throw new Error(d.error);
  const seen = new Set();
  const videos = (d.videoStreams || [])
    .filter((v) => v.url && v.videoOnly === false && !seen.has(v.quality) && seen.add(v.quality))
    .map((v) => ({
      label: v.quality || "?",
      url: v.url,
      ext: (v.mimeType || "").includes("webm") ? "webm" : "mp4",
    }));
  const audios = (d.audioStreams || [])
    .filter((a) => a.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    .map((a) => ({
      label: `${(a.mimeType || "").includes("mp4") ? "M4A" : "OPUS"}${a.bitrate ? " · " + Math.round(a.bitrate / 1000) + " kbps" : ""}`,
      url: a.url,
      ext: (a.mimeType || "").includes("mp4") ? "m4a" : "opus",
    }));
  return { videos, audios };
}

async function getInfoInvidious(base, id) {
  const res = await fetchWithTimeout(
    `${base}/api/v1/videos/${id}?local=true&fields=format_streams,adaptiveFormats`, {}, 15000
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
  return { videos, audios };
}

function getInfoCobalt() {
  return {
    videos: COBALT_VIDEOS.map(([q, label], i) => ({
      label: i === 0 ? t("bestQuality") : label,
      cobalt: { videoQuality: q },
      ext: "mp4",
    })),
    audios: COBALT_AUDIOS.map((a) => ({
      label: a.label,
      cobalt: { audioFormat: a.fmt, audioBitrate: a.br },
      ext: a.ext,
    })),
  };
}

async function cobaltDownload(base, videoUrl, params) {
  const body = params.audioFormat
    ? { url: videoUrl, downloadMode: "audio", audioFormat: params.audioFormat, audioBitrate: params.audioBitrate }
    : { url: videoUrl, downloadMode: "auto", videoQuality: params.videoQuality };
  const res = await fetchWithTimeout(`${base}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  }, 25000);
  const j = await res.json().catch(() => ({}));
  if (j.status === "picker" && j.picker?.length) return { url: j.picker[0].url, filename: j.picker[0].filename };
  if (j.url) return { url: j.url, filename: j.filename };
  throw new Error(j.error?.code || `cobalt ${res.status}`);
}

/* ------------------------------ Conexão -------------------------------- */

async function buildCandidateList() {
  const list = [];
  const seen = new Set();
  const push = (c) => {
    if (c && c.base && !seen.has(c.base)) {
      seen.add(c.base);
      list.push({ engine: c.engine, base: c.base.replace(/\/+$/, "") });
    }
  };
  // 1) servidores do projeto (servers.json do repositório)
  try {
    const res = await fetchWithTimeout(`${SERVERS_JSON}?t=${Date.now()}`, {}, 6000);
    if (res.ok) {
      const j = await res.json();
      (j.primary || []).forEach(push);
    }
  } catch { /* sem lista, tudo bem */ }
  PRIMARY_COUNT = list.length; // os primeiros N são "do projeto" (com direito a 2 tentativas)
  // 2) estáticos
  STATIC_CANDIDATES.forEach(push);
  // 3) listas dinâmicas
  const dyn = await Promise.allSettled(
    DYNAMIC_SOURCES.map(async (src) => {
      const res = await fetchWithTimeout(src.url, {}, 6000);
      if (!res.ok) return [];
      return src.parse(await res.json());
    })
  );
  dyn.forEach((r) => r.status === "fulfilled" && r.value.forEach(push));
  return list;
}

async function connect(force = false) {
  if (state.connecting && !force) return state.connecting;
  state.connecting = (async () => {
    setChip("", t("connecting"));
    if (!state.candidates.length || force) state.candidates = await buildCandidateList();
    for (let i = 0; i < state.candidates.length; i++) {
      const c = state.candidates[i];
      const isPrimary = i < PRIMARY_COUNT;
      // servidores do projeto ganham 2 tentativas (plano free "adormece")
      const ok = (await testCandidate(c, isPrimary ? 15000 : 8000)) ||
        (isPrimary && (await testCandidate(c, 15000)));
      if (ok) {
        state.idx = i;
        setChip("ok", `${t("connected")} · ${shortHost(c.base)}`);
        updateServerInfo();
        return true;
      }
    }
    state.idx = -1;
    setChip("err", t("noServer"));
    updateServerInfo();
    return false;
  })();
  try { return await state.connecting; } finally { state.connecting = null; }
}

let PRIMARY_COUNT = 0; // quantos candidatos vieram do servers.json

/* --------------------------- Interface/busca --------------------------- */

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function sanitizeFilename(name) {
  return (name || "ytgrab").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
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
  $("tabVideo").disabled = !state.info.videos.length;
  $("tabAudio").disabled = !state.info.audios.length;
  if (!state.info.videos.length && state.info.audios.length) $("tabAudio").click();
}

/* Busca com fallback TOTAL: percorre a cadeia até um servidor entregar */
async function doFetch() {
  if (state.busy) return;
  const id = extractVideoId($("urlInput").value.trim());
  if (!id) return setStatus(t("invalidUrl"), "err");

  state.busy = true;
  $("btnFetch").disabled = true;
  setStatus(t("fetching"));

  try {
    // Metadados direto do YouTube (oEmbed, CORS aberto) — nunca falha a UI
    const metaPromise = oEmbed(id);

    if (!state.candidates.length) state.candidates = await buildCandidateList();
    if (state.idx < 0 && !(await connect())) throw new Error("no-server");

    const start = Math.max(state.idx, 0);
    const order = [...state.candidates.slice(start), ...state.candidates.slice(0, start)];
    let info = null;
    let chosen = null;

    for (let n = 0; n < order.length; n++) {
      const c = order[n];
      setStatus(n === 0 ? t("fetching") : `${t("trying")} (${n + 1}/${order.length})…`);
      try {
        if (c.engine === "cobalt") {
          // valida com o vídeo REAL antes de adotar (evita servidor zumbi)
          await cobaltDownload(c.base, `https://www.youtube.com/watch?v=${id}`, { videoQuality: "144" });
          info = getInfoCobalt();
        } else if (c.engine === "piped") {
          info = await getInfoPiped(c.base, id);
          if (!info.videos.length && !info.audios.length) throw new Error("vazio");
        } else {
          info = await getInfoInvidious(c.base, id);
          if (!info.videos.length && !info.audios.length) throw new Error("vazio");
        }
        chosen = c;
        break;
      } catch {
        info = null;
      }
    }

    if (!chosen) throw new Error("all-failed");

    state.idx = state.candidates.indexOf(chosen);
    setChip("ok", `${t("connected")} · ${shortHost(chosen.base)}`);
    updateServerInfo();

    const meta = await metaPromise;
    state.videoId = id;
    state.info = info;
    $("thumb").src = meta.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    $("videoTitle").textContent = meta.title || "YouTube · " + id;
    $("videoDuration").textContent = "";
    fillOptions();
    $("result").classList.remove("hidden");
    setStatus("");
  } catch (e) {
    if (e.message === "no-server") setChip("err", t("noServer"));
    setStatus(t("errFetch"), "err");
    console.error(e);
  } finally {
    state.busy = false;
    $("btnFetch").disabled = false;
  }
}

/* ------------------------------ Download ------------------------------- */

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
    const videoUrl = `https://www.youtube.com/watch?v=${state.videoId}`;

    if (item.cobalt) {
      // tenta todos os servidores cobalt da cadeia
      const cobalts = state.candidates.filter((c) => c.engine === "cobalt");
      let last;
      for (const c of cobalts) {
        try {
          const r = await cobaltDownload(c.base, videoUrl, item.cobalt);
          return await saveFile(r.url, r.filename || `${sanitizeFilename($("videoTitle").textContent)}.${item.ext}`);
        } catch (e) { last = e; }
      }
      throw last || new Error("cobalt");
    }
    await saveFile(item.url, `${sanitizeFilename($("videoTitle").textContent)}.${item.ext}`);
  } catch (e) {
    setStatus(t("errFetch"), "err");
    console.error(e);
  } finally {
    state.busy = false;
    $("btnDownload").disabled = false;
  }
}

/* -------------------------------- i18n --------------------------------- */

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
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("btnTheme").textContent = state.theme === "dark" ? "🌙" : "☀️";
}

function updateServerInfo() {
  const a = active();
  $("serverInfo").textContent = `${t("currentServer")} ${a ? shortHost(a.base) : "—"}`;
}

/* -------------------------------- Init --------------------------------- */

async function init() {
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
  $("connChip").onclick = () => { if (!active()) connect(true); };

  $("btnFetch").onclick = doFetch;
  $("urlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doFetch(); });
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

  // monta a cadeia (servers.json primeiro) e conecta
  state.candidates = await buildCandidateList();
  connect(true);
}

init();
