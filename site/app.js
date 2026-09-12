/* YTGrab Web — frontend estático (GitHub Pages).
 * O download em si é feito por um backend configurável:
 *  - Cobalt (recomendado): instância própria grátis no Render (guia embutido)
 *  - Invidious: instâncias públicas (instáveis, sem cadastro)
 */

const I18N = {
  pt: {
    tagline: "Baixe vídeos e músicas do YouTube",
    getInfo: "Buscar",
    download: "Baixar",
    downloading: "Baixando",
    tabVideo: "Vídeo (MP4)",
    tabAudio: "Áudio",
    quality: "Qualidade:",
    audioFormat: "Formato:",
    audioBitrate: "Bitrate:",
    settings: "Configurações",
    backendType: "Servidor (backend)",
    backendUrl: "Endereço do servidor",
    test: "Testar",
    testing: "Testando...",
    tryPublic: "Ou tente uma instância pública (instável):",
    howToSetup: "📖 Como criar o seu servidor Cobalt de graça (5 min)",
    save: "Salvar",
    close: "Fechar",
    madeBy: "Feito por",
    getTheApp: "Prefere o app?",
    downloadApp: "Baixe o YTGrab",
    androidApp: "App Android (TuneGrab)",
    urlPlaceholder: "Cole o link do YouTube aqui...",
    needBackendTitle: "⚠️ Configure um servidor primeiro",
    needBackendText: "O navegador não consegue falar com o YouTube diretamente (bloqueio de CORS). O site precisa de um servidor gratuito para extrair os vídeos — o seu, ou uma instância pública. Leva 2 minutinhos. ⚙️",
    invalidUrl: "Link do YouTube inválido.",
    fetching: "Buscando informações do vídeo...",
    fetchError: "Não consegui falar com o servidor. Verifique o endereço nas configurações (⚙️).",
    noBackend: "Nenhum servidor configurado — abra as configurações (⚙️).",
    readyToDownload: "Pronto! Escolha o formato/qualidade e clique em Baixar. (O título e as opções aparecem após o download começar.)",
    downloadStarted: "Download iniciado!",
    done: "Download concluído! Confira a pasta de downloads.",
    openedNewTab: "Abri o arquivo em uma nova aba — use Ctrl+S (ou o menu ⋮) para salvar.",
    errGeneric: "O servidor retornou um erro: ",
    errBot: "O YouTube bloqueou o servidor temporariamente (detecção de bot). Tente de novo em alguns minutos ou troque de servidor (⚙️).",
    errInstance: "Instância offline ou indisponível. Tente outra em ⚙️.",
    maxQuality: "Máxima (recomendado)",
    backendOk: "✅ Servidor online!",
    backendFail: "❌ Não respondeu. Confira o endereço ou tente outra instância.",
    saved: "Configurações salvas ✅",
    guideHtml: `<ol>
      <li>Crie uma conta grátis em <a href="https://render.com" target="_blank">render.com</a> (pode entrar com o GitHub).</li>
      <li><b>New → Web Service</b> → conecte um repositório público qualquer (ou faça fork do <a href="https://github.com/imputnet/cobalt" target="_blank">cobalt</a>).</li>
      <li>Runtime: <b>Docker</b>, com o Dockerfile: <pre>FROM ghcr.io/imputnet/cobalt:latest</pre></li>
      <li>Em <b>Environment</b> defina: <code>API_URL=https://SEU-NOME.onrender.com/</code> e <code>API_PORT=9000</code>.</li>
      <li>Plano <b>Free</b> → Create. Em ~2 min o deploy termina.</li>
      <li>Cole <code>https://SEU-NOME.onrender.com</code> aqui em cima e clique em <b>Testar</b>. 🎉</li>
    </ol>
    <p class="sub">O plano free "adormece" sem uso — o primeiro download pode demorar ~1 min para acordar.</p>`,
  },
  en: {
    tagline: "Download YouTube videos and music",
    getInfo: "Search",
    download: "Download",
    downloading: "Downloading",
    tabVideo: "Video (MP4)",
    tabAudio: "Audio",
    quality: "Quality:",
    audioFormat: "Format:",
    audioBitrate: "Bitrate:",
    settings: "Settings",
    backendType: "Server (backend)",
    backendUrl: "Server address",
    test: "Test",
    testing: "Testing...",
    tryPublic: "Or try a public instance (unstable):",
    howToSetup: "📖 How to create your own free Cobalt server (5 min)",
    save: "Save",
    close: "Close",
    madeBy: "Made by",
    getTheApp: "Prefer the app?",
    downloadApp: "Get YTGrab",
    androidApp: "Android app (TuneGrab)",
    urlPlaceholder: "Paste the YouTube link here...",
    needBackendTitle: "⚠️ Set up a server first",
    needBackendText: "Browsers can't talk to YouTube directly (CORS). The site needs a free server to extract videos — your own, or a public instance. It takes 2 minutes. ⚙️",
    invalidUrl: "Invalid YouTube link.",
    fetching: "Fetching video info...",
    fetchError: "Could not reach the server. Check the address in settings (⚙️).",
    noBackend: "No server configured — open settings (⚙️).",
    readyToDownload: "Ready! Pick a format/quality and hit Download. (Title and options appear after the download starts.)",
    downloadStarted: "Download started!",
    done: "Download complete! Check your downloads folder.",
    openedNewTab: "Opened the file in a new tab — use Ctrl+S (or the ⋮ menu) to save it.",
    errGeneric: "The server returned an error: ",
    errBot: "YouTube temporarily blocked the server (bot detection). Try again in a few minutes or switch servers (⚙️).",
    errInstance: "Instance offline or unavailable. Try another one in ⚙️.",
    maxQuality: "Best (recommended)",
    backendOk: "✅ Server online!",
    backendFail: "❌ No response. Check the address or try another instance.",
    saved: "Settings saved ✅",
    guideHtml: `<ol>
      <li>Create a free account at <a href="https://render.com" target="_blank">render.com</a> (GitHub login works).</li>
      <li><b>New → Web Service</b> → connect any public repo (or fork <a href="https://github.com/imputnet/cobalt" target="_blank">cobalt</a>).</li>
      <li>Runtime: <b>Docker</b>, with the Dockerfile: <pre>FROM ghcr.io/imputnet/cobalt:latest</pre></li>
      <li>Under <b>Environment</b> set: <code>API_URL=https://YOUR-NAME.onrender.com/</code> and <code>API_PORT=9000</code>.</li>
      <li>Plan <b>Free</b> → Create. Deploy finishes in ~2 min.</li>
      <li>Paste <code>https://YOUR-NAME.onrender.com</code> above and click <b>Test</b>. 🎉</li>
    </ol>
    <p class="sub">The free plan sleeps when idle — the first download may take ~1 min to wake it up.</p>`,
  },
};

const PUBLIC_INSTANCES = [
  "https://invidious.f5.si",
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://iv.ggtyler.dev",
];

const $ = (id) => document.getElementById(id);

const state = {
  lang: localStorage.getItem("ytgrabweb_lang") || "pt",
  theme: localStorage.getItem("ytgrabweb_theme") || "dark",
  backend: JSON.parse(localStorage.getItem("ytgrabweb_backend") || '{"type":"invidious","url":""}'),
  videoId: "",
  info: null, // resposta do invidious (quando houver)
  mode: "video", // video | audio
  busy: false,
};

function t(key) { return I18N[state.lang][key] ?? key; }

function applyI18n() {
  document.documentElement.lang = state.lang === "pt" ? "pt-BR" : "en";
  $("tagline").textContent = t("tagline");
  $("urlInput").placeholder = t("urlPlaceholder");
  $("needBackendTitle").textContent = t("needBackendTitle");
  $("needBackendText").textContent = t("needBackendText");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $("setupGuide").innerHTML = t("guideHtml");
  $("backendType").value = state.backend.type;
  $("backendUrl").value = state.backend.url;
  updateVideoQualityOptions();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("btnTheme").textContent = state.theme === "dark" ? "🌙" : "☀️";
}

function saveBackend() {
  localStorage.setItem("ytgrabweb_backend", JSON.stringify(state.backend));
}

function updateBackendWarning() {
  $("needBackend").classList.toggle("hidden", !!state.backend.url);
}

function extractVideoId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

function setStatus(msg, cls = "") {
  const el = $("statusMsg");
  el.textContent = msg;
  el.className = "status " + cls;
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function sanitizeFilename(name) {
  return (name || "ytgrab").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

/* ------------------------- Backend: Invidious ------------------------- */

async function invidiousFetchInfo(videoId) {
  const base = state.backend.url.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/api/v1/videos/${videoId}?local=true&fields=title,lengthSeconds,thumbnails,format_streams,adaptiveFormats`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fillInvidiousOptions() {
  const info = state.info;
  const vq = $("videoQuality");
  vq.innerHTML = "";
  (info.format_streams || [])
    .sort((a, b) => parseInt(b.qualityLabel) - parseInt(a.qualityLabel))
    .forEach((f) => {
      const o = document.createElement("option");
      o.value = f.itag;
      o.textContent = `${f.qualityLabel} · ${f.container?.toUpperCase?.() || "MP4"}`;
      vq.appendChild(o);
    });

  const af = $("audioFormat");
  af.innerHTML = "";
  const audios = (info.adaptiveFormats || []).filter((f) =>
    (f.type || "").startsWith("audio/")
  );
  const seen = new Set();
  audios.forEach((f) => {
    const label = (f.type || "").includes("mp4") ? "M4A" : "OPUS";
    if (seen.has(label + f.bitrate)) return;
    seen.add(label + f.bitrate);
    const o = document.createElement("option");
    o.value = f.itag;
    o.textContent = `${label} · ${Math.round((f.bitrate || 0) / 1000)} kbps`;
    af.appendChild(o);
  });
  $("audioBitrate").classList.add("hidden"); // bitrate já vem embutido no stream
}

/* -------------------------- Backend: Cobalt -------------------------- */

async function cobaltRequest(videoUrl, body) {
  const base = state.backend.url.replace(/\/+$/, "");
  const res = await fetch(`${base}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url: videoUrl, ...body }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function updateVideoQualityOptions() {
  if (state.backend.type !== "cobalt") return;
  const vq = $("videoQuality");
  const cur = vq.value;
  vq.innerHTML = "";
  [["max", t("maxQuality")], ["2160", "4K (2160p)"], ["1440", "1440p"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"], ["240", "240p"], ["144", "144p"]]
    .forEach(([v, label]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      vq.appendChild(o);
    });
  vq.value = cur && [...vq.options].some((o) => o.value === cur) ? cur : "max";
  $("audioBitrate").classList.remove("hidden");
}

/* ------------------------------ Download ------------------------------ */

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

function fallbackOpen(url) {
  window.open(url, "_blank", "noopener");
  setStatus(t("openedNewTab"), "ok");
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
    fallbackOpen(url);
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
  if (!state.backend.url) return setStatus(t("noBackend"), "err");

  state.videoId = id;
  state.info = null;
  state.busy = true;
  $("btnFetch").disabled = true;
  setStatus(t("fetching"));

  try {
    if (state.backend.type === "invidious") {
      state.info = await invidiousFetchInfo(id);
      $("thumb").src =
        (state.info.thumbnails || []).slice(-1)[0]?.url ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      $("videoTitle").textContent = state.info.title || "";
      $("videoDuration").textContent = fmtDuration(state.info.lengthSeconds || 0);
      fillInvidiousOptions();
    } else {
      $("thumb").src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      $("videoTitle").textContent = "YouTube · " + id;
      $("videoDuration").textContent = t("readyToDownload");
      updateVideoQualityOptions();
    }
    $("result").classList.remove("hidden");
    setStatus("");
  } catch (e) {
    setStatus(
      state.backend.type === "invidious" ? t("errInstance") : t("fetchError"),
      "err"
    );
    console.error(e);
  } finally {
    state.busy = false;
    $("btnFetch").disabled = false;
  }
}

async function doDownload() {
  if (state.busy || !state.videoId) return;
  const url = `https://www.youtube.com/watch?v=${state.videoId}`;
  state.busy = true;
  $("btnDownload").disabled = true;
  setStatus("");
  try {
    if (state.backend.type === "invidious") {
      const itag = state.mode === "video" ? $("videoQuality").value : $("audioFormat").value;
      const all = [...(state.info.format_streams || []), ...(state.info.adaptiveFormats || [])];
      const stream = all.find((f) => String(f.itag) === String(itag));
      if (!stream) throw new Error("stream não encontrado");
      const ext = (stream.container || ((stream.type || "").includes("mp4") ? "m4a" : "webm")).toLowerCase();
      await saveFile(stream.url, `${sanitizeFilename(state.info.title)}.${ext}`);
    } else {
      const body =
        state.mode === "video"
          ? { downloadMode: "auto", videoQuality: $("videoQuality").value }
          : {
              downloadMode: "audio",
              audioFormat: $("audioFormat").value,
              audioBitrate: $("audioBitrate").value,
            };
      const r = await cobaltRequest(url, body);
      if (r.status === "error") {
        const code = r.error?.code || "";
        if (code.includes("bot")) setStatus(t("errBot"), "err");
        else setStatus(t("errGeneric") + code, "err");
        return;
      }
      if (r.status === "picker" && r.picker?.length) {
        // vídeos com vários clipes: baixa o primeiro
        const pick = r.picker[0];
        await saveFile(pick.url, pick.filename || `ytgrab_${state.videoId}.mp4`);
      } else if (r.url) {
        await saveFile(r.url, r.filename || `ytgrab_${state.videoId}.mp4`);
      } else {
        setStatus(t("errGeneric") + JSON.stringify(r).slice(0, 120), "err");
      }
    }
  } catch (e) {
    setStatus(t("fetchError") + " (" + e.message + ")", "err");
    console.error(e);
  } finally {
    state.busy = false;
    $("btnDownload").disabled = false;
  }
}

async function testBackend(type, url) {
  const el = $("backendTestResult");
  el.textContent = t("testing");
  el.className = "status";
  const base = url.replace(/\/+$/, "");
  try {
    if (type === "cobalt") {
      const res = await fetch(`${base}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", downloadMode: "audio", audioFormat: "mp3" }),
      });
      const j = await res.json().catch(() => ({}));
      // auth necessária ou erro de rede => falha; status tunnel/redirect/erro do youtube => API viva
      if (j.status === "error" && String(j.error?.code || "").includes("auth")) {
        el.textContent = t("backendFail") + " (JWT)";
        el.className = "status err";
        return false;
      }
      el.textContent = t("backendOk");
      el.className = "status ok";
      return true;
    }
    const res = await fetch(`${base}/api/v1/videos/jNQXAC9IVRw?fields=title`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    el.textContent = t("backendOk");
    el.className = "status ok";
    return true;
  } catch {
    el.textContent = t("backendFail");
    el.className = "status err";
    return false;
  }
}

/* ------------------------------ Instâncias ----------------------------- */

function renderInstanceList() {
  const box = $("instanceList");
  box.innerHTML = "";
  PUBLIC_INSTANCES.forEach((inst) => {
    const row = document.createElement("div");
    row.className = "instance-item";
    row.innerHTML = `<code>${inst}</code>`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = t("test");
    btn.onclick = async () => {
      $("backendType").value = "invidious";
      $("backendUrl").value = inst;
      const ok = await testBackend("invidious", inst);
      if (ok) {
        state.backend = { type: "invidious", url: inst };
        saveBackend();
        updateBackendWarning();
        setStatus(t("saved"), "ok");
      }
    };
    row.appendChild(btn);
    box.appendChild(row);
  });
}

/* -------------------------------- Init -------------------------------- */

function init() {
  applyTheme();
  applyI18n();
  updateBackendWarning();
  renderInstanceList();

  $("btnTheme").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("ytgrabweb_theme", state.theme);
    applyTheme();
  };
  $("btnLang").onclick = () => {
    state.lang = state.lang === "pt" ? "en" : "pt";
    localStorage.setItem("ytgrabweb_lang", state.lang);
    applyI18n();
    renderInstanceList();
    updateBackendWarning();
  };
  $("btnSettings").onclick = () => {
    $("settingsModal").classList.remove("hidden");
    $("backendType").value = state.backend.type;
    $("backendUrl").value = state.backend.url;
  };
  $("btnOpenSettingsFromWarn").onclick = () => $("btnSettings").click();
  $("btnCloseSettings").onclick = () => $("settingsModal").classList.add("hidden");
  $("btnSaveSettings").onclick = () => {
    state.backend = {
      type: $("backendType").value,
      url: $("backendUrl").value.trim(),
    };
    saveBackend();
    updateBackendWarning();
    updateVideoQualityOptions();
    $("settingsModal").classList.add("hidden");
    setStatus(t("saved"), "ok");
  };
  $("btnTestBackend").onclick = () =>
    testBackend($("backendType").value, $("backendUrl").value.trim());
  $("backendType").onchange = () => {
    $("quickInstances").classList.toggle(
      "hidden",
      $("backendType").value !== "invidious"
    );
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
}

init();
