import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, useCallback } from "react";
import {
  Download,
  Music,
  Video,
  Search,
  FolderOpen,
  X,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
  Settings,
  Terminal,
  Package,
} from "lucide-react";
import type {
  VideoInfo,
  DownloadItem,
  DownloadProgress,
} from "./types";
import { AUDIO_QUALITIES, VIDEO_QUALITIES } from "./types";

// ─── App Principal ────────────────────────────────────────

export default function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp3" | "mp4">("mp4");
  const [quality, setQuality] = useState("1080");
  const [outputDir, setOutputDir] = useState("~/Downloads");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [depsReady, setDepsReady] = useState(false);
  const [depsInfo, setDepsInfo] = useState<Record<string, string | null>>({});
  const [fetchingInfo, setFetchingInfo] = useState(false);

  // Modal de instalação
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");
  const [installPct, setInstallPct] = useState(0);
  const [installDone, setInstallDone] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installInfo, setInstallInfo] = useState<Record<string, string> | null>(null);

  // Verificar dependências ao abrir
  useEffect(() => {
    invoke<Record<string, string | null>>("check_dependencies").then((res) => {
      setDepsInfo(res);
      setDepsReady(res.ready === true || res.ytdlp !== null);
    });
    invoke<string>("get_default_download_dir").then(setOutputDir);
  }, []);

  // Escutar progresso de download
  useEffect(() => {
    const unlisten = listen<DownloadProgress>("download-progress", (event) => {
      const p = event.payload;
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === p.id
            ? { ...d, percent: p.percent, speed: p.speed, eta: p.eta, status: p.status, error: p.error }
            : d
        )
      );
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Escutar progresso de instalação
  useEffect(() => {
    const unlisten = listen<{ message: string; percent: number }>("install-progress", (event) => {
      setInstallMsg(event.payload.message);
      setInstallPct(event.payload.percent);
      if (event.payload.percent >= 100) {
        setInstallDone(true);
        setInstalling(false);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Trocar qualidade padrão ao mudar formato
  useEffect(() => {
    if (format === "mp3") setQuality("best");
    else setQuality("1080");
  }, [format]);

  // Buscar info do vídeo
  const fetchInfo = useCallback(async () => {
    if (!url.trim()) return;
    setFetchingInfo(true);
    setError("");
    setVideoInfo(null);
    try {
      const info = await invoke<VideoInfo>("get_video_info", { url: url.trim() });
      setVideoInfo(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setFetchingInfo(false);
    }
  }, [url]);

  // Escolher pasta de saída
  const browseFolder = async () => {
    const selected = await open({ directory: true, title: "Pasta de destino" });
    if (selected) setOutputDir(String(selected));
  };

  // Iniciar download
  const startDownload = async () => {
    if (!url.trim() || !depsReady) return;
    setLoading(true);
    setError("");

    const title = videoInfo?.title || url.split("/").pop() || "video";
    const safeTitle = title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80);
    const id = `dl-${Date.now()}`;

    const newItem: DownloadItem = {
      id, url: url.trim(), title, format, quality,
      percent: 0, speed: "", eta: "", status: "downloading", error: null,
    };

    setDownloads((prev) => [newItem, ...prev]);

    try {
      await invoke("download", {
        options: { url: url.trim(), format, quality, output_dir: outputDir, filename: safeTitle },
      });
    } catch (e) {
      setError(String(e));
      setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, status: "error", error: String(e) } : d)));
    } finally {
      setLoading(false);
    }
  };

  // Abrir modal de instalação
  const openInstallModal = async () => {
    setShowInstallModal(true);
    setInstallDone(false);
    setInstallError("");
    setInstallMsg("");
    setInstallPct(0);
    try {
      const info = await invoke<Record<string, string>>("get_ytdlp_install_info");
      setInstallInfo(info);
    } catch (e) {
      setInstallInfo(null);
    }
  };

  // Instalar yt-dlp automaticamente
  const doInstall = async () => {
    setInstalling(true);
    setInstallError("");
    setInstallDone(false);
    try {
      const path = await invoke<string>("install_ytdlp");
      // Re-check dependencies
      const res = await invoke<Record<string, string | null>>("check_dependencies");
      setDepsInfo(res);
      setDepsReady(res.ready === true || res.ytdlp !== null);
    } catch (e) {
      setInstallError(String(e));
      setInstalling(false);
    }
  };

  // Fechar modal e re-check se instalou
  const closeModal = () => {
    setShowInstallModal(false);
    if (installDone) {
      invoke<Record<string, string | null>>("check_dependencies").then((res) => {
        setDepsInfo(res);
        setDepsReady(res.ready === true || res.ytdlp !== null);
      });
    }
  };

  const qualityOptions = format === "mp3" ? AUDIO_QUALITIES : VIDEO_QUALITIES;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Cabeçalho */}
      <header data-tauri-drag-region className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 bg-zinc-950">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-600">
          <svg viewBox="0 0 100 100" className="w-5 h-5" fill="white"><polygon points="35,22 35,78 75,50" /></svg>
        </div>
        <h1 className="text-base font-semibold tracking-tight">YTGrab</h1>
        <div className="flex-1" />
        {!depsReady && (
          <button
            onClick={openInstallModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 transition"
          >
            <Package size={14} /> Instalar yt-dlp
          </button>
        )}
      </header>

      {/* Conteúdo principal */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Input URL */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">URL do YouTube</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 transition"
              />
              {url && (
                <button onClick={() => { setUrl(""); setVideoInfo(null); setError(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                  <X size={16} />
                </button>
              )}
            </div>
            <button onClick={fetchInfo} disabled={!url.trim() || fetchingInfo}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition">
              {fetchingInfo ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Info
            </button>
          </div>
        </div>

        {/* Preview do vídeo */}
        {videoInfo && (
          <div className="flex gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/50">
            {videoInfo.thumbnail && <img src={videoInfo.thumbnail} alt="" className="w-28 h-20 rounded-lg object-cover flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-snug line-clamp-2">{videoInfo.title}</p>
              {videoInfo.duration && (
                <p className="text-xs text-zinc-400 mt-1">{Math.floor(videoInfo.duration / 60)}:{String(videoInfo.duration % 60).padStart(2, "0")}</p>
              )}
            </div>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/40 border border-red-800/30 text-red-400 text-sm">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Formato e Qualidade */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Formato</label>
            <div className="flex rounded-lg bg-zinc-900 border border-zinc-800/50 p-1">
              <button onClick={() => setFormat("mp4")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${format === "mp4" ? "bg-red-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"}`}>
                <Video size={16} /> MP4
              </button>
              <button onClick={() => setFormat("mp3")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${format === "mp3" ? "bg-red-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"}`}>
                <Music size={16} /> MP3
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Qualidade</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)}
              className="w-full py-2.5 px-3 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 focus:outline-none focus:border-red-500/50 transition appearance-none cursor-pointer">
              {qualityOptions.map((q) => (<option key={q.value} value={q.value}>{q.label}</option>))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Salvar em</label>
            <div className="flex gap-2">
              <input type="text" value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
                className="flex-1 py-2.5 px-3 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 focus:outline-none focus:border-red-500/50 transition" />
              <button onClick={browseFolder} className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 transition">
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Botão Baixar */}
        <button onClick={startDownload} disabled={!url.trim() || loading || !depsReady}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm shadow-lg shadow-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition">
          {loading ? (<><Loader2 size={18} className="animate-spin" /> Baixando...</>) : (<><Download size={18} /> Baixar {format.toUpperCase()}</>)}
        </button>

        {/* Lista de downloads */}
        {downloads.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Downloads</h3>
            {downloads.map((d) => (
              <div key={d.id} className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/50 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-xs text-zinc-500">{d.format.toUpperCase()} · {d.quality}</p>
                  </div>
                  {d.status === "done" && <Check size={18} className="text-emerald-400 flex-shrink-0" />}
                  {d.status === "error" && <AlertCircle size={18} className="text-red-400 flex-shrink-0" />}
                  {(d.status === "downloading" || d.status === "processing") && <Loader2 size={18} className="animate-spin text-red-400 flex-shrink-0" />}
                </div>
                {d.status === "downloading" && (
                  <>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full rounded-full bg-red-500 transition-all duration-300" style={{ width: `${d.percent}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>{d.percent.toFixed(1)}%</span>
                      {d.speed && <span>{d.speed}</span>}
                      {d.eta && <span>ETA {d.eta}</span>}
                    </div>
                  </>
                )}
                {d.status === "processing" && <p className="text-xs text-amber-400">Processando (merge/conversão)...</p>}
                {d.status === "error" && d.error && <p className="text-xs text-red-400">{d.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rodapé */}
      <footer className="px-4 py-2 border-t border-zinc-800/40 text-center">
        <p className="text-[11px] text-zinc-600">yt-dlp + ffmpeg · Tauri v2</p>
      </footer>

      {/* ─── Modal de Instalação ─── */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[380px] max-h-[90vh] overflow-y-auto rounded-2xl bg-zinc-900 border border-zinc-700/50 shadow-2xl">
            {/* Cabeçalho do modal */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15">
                  <Package size={18} className="text-amber-400" />
                </div>
                <h2 className="text-base font-semibold">Instalar yt-dlp</h2>
              </div>
              <button onClick={closeModal} className="text-zinc-500 hover:text-zinc-300 transition">
                <X size={18} />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="px-5 py-4 space-y-4">
              {/* Status atual */}
              <div className="flex items-center gap-2 text-sm">
                {depsInfo.ytdlp ? (
                  <>
                    <Check size={16} className="text-emerald-400" />
                    <span className="text-emerald-400">yt-dlp já instalado</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} className="text-amber-400" />
                    <span className="text-amber-400">yt-dlp não encontrado</span>
                  </>
                )}
              </div>

              {/* Instrução importante */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm space-y-2">
                <p className="font-semibold">⚠️ Importante</p>
                <p>Se usar o comando abaixo, quando aparecer a pergunta sobre aceitar os termos, digite <code className="bg-amber-500/20 px-1.5 py-0.5 rounded font-bold">Y</code> e pressione Enter.</p>
              </div>

              {/* Comando alternativo */}
              {installInfo && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Comando alternativo (terminal)</label>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-950 border border-zinc-800/50">
                    <Terminal size={14} className="text-zinc-500 flex-shrink-0" />
                    <code className="text-xs text-red-400 font-mono flex-1 break-all">{installInfo.command}</code>
                  </div>
                  {installInfo.hint && (
                    <p className="text-xs text-zinc-500">{installInfo.hint}</p>
                  )}
                </div>
              )}

              {/* Botão de instalação automática */}
              {!installDone && !installError && (
                <button onClick={doInstall} disabled={installing}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition">
                  {installing ? (
                    <><Loader2 size={16} className="animate-spin" /> {installMsg || "Instalando..."}</>
                  ) : (
                    <><Package size={16} /> Baixar e instalar automaticamente</>
                  )}
                </button>
              )}

              {/* Barra de progresso da instalação */}
              {installing && (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${installPct}%` }} />
                  </div>
                  <p className="text-xs text-zinc-500 text-center">{installPct.toFixed(0)}%</p>
                </div>
              )}

              {/* Sucesso */}
              {installDone && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Check size={18} className="text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-emerald-400">yt-dlp instalado com sucesso!</p>
                    <p className="text-xs text-zinc-400 mt-0.5">Reinicie o app se necessário.</p>
                  </div>
                </div>
              )}

              {/* Erro */}
              {installError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/40 border border-red-800/30">
                  <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-red-400">{installError}</p>
                    <p className="text-xs text-zinc-500 mt-1">Tente instalar manualmente usando o comando acima.</p>
                  </div>
                </div>
              )}

              {/* Link manual */}
              <a href="https://github.com/yt-dlp/yt-dlp/releases/latest" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition">
                <ExternalLink size={12} /> Baixar manualmente do GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
