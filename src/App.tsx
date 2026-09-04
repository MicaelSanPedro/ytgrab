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
} from "lucide-react";
import type {
  VideoInfo,
  DownloadItem,
  DownloadProgress,
} from "./types";
import { AUDIO_QUALITIES, VIDEO_QUALITIES } from "./types";

// ─── Main App ─────────────────────────────────────────────

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

  // Check dependencies on mount
  useEffect(() => {
    invoke<Record<string, string | null>>("check_dependencies").then((res) => {
      setDepsInfo(res);
      setDepsReady(res.ready === true || res.ytdlp !== null);
    });

    invoke<string>("get_default_download_dir").then(setOutputDir);
  }, []);

  // Listen for download progress
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
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Auto-switch quality default when format changes
  useEffect(() => {
    if (format === "mp3") setQuality("best");
    else setQuality("1080");
  }, [format]);

  // Fetch video info
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

  // Browse output folder
  const browseFolder = async () => {
    const selected = await open({ directory: true, title: "Pasta de destino" });
    if (selected) setOutputDir(String(selected));
  };

  // Start download
  const startDownload = async () => {
    if (!url.trim() || !depsReady) return;
    setLoading(true);
    setError("");

    const title = videoInfo?.title || url.split("/").pop() || "video";
    const safeTitle = title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80);
    const id = `dl-${Date.now()}`;

    const newItem: DownloadItem = {
      id,
      url: url.trim(),
      title,
      format,
      quality,
      percent: 0,
      speed: "",
      eta: "",
      status: "downloading",
      error: null,
    };

    setDownloads((prev) => [newItem, ...prev]);

    try {
      await invoke("download", {
        options: {
          url: url.trim(),
          format,
          quality,
          outputDir,
          filename: safeTitle,
        },
      });
    } catch (e) {
      setError(String(e));
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "error", error: String(e) } : d))
      );
    } finally {
      setLoading(false);
    }
  };

  const qualityOptions = format === "mp3" ? AUDIO_QUALITIES : VIDEO_QUALITIES;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header
        data-tauri-drag-region
        className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 bg-zinc-950"
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-600">
          <svg viewBox="0 0 100 100" className="w-5 h-5" fill="white">
            <polygon points="35,22 35,78 75,50" />
          </svg>
        </div>
        <h1 className="text-base font-semibold tracking-tight">YTGrab</h1>
        <div className="flex-1" />
        {!depsReady && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <AlertCircle size={14} /> yt-dlp ausente
          </span>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* URL Input */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            URL do YouTube
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 transition"
              />
              {url && (
                <button
                  onClick={() => { setUrl(""); setVideoInfo(null); setError(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={fetchInfo}
              disabled={!url.trim() || fetchingInfo}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {fetchingInfo ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Info
            </button>
          </div>
        </div>

        {/* Video Preview */}
        {videoInfo && (
          <div className="flex gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/50">
            {videoInfo.thumbnail && (
              <img
                src={videoInfo.thumbnail}
                alt=""
                className="w-28 h-20 rounded-lg object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-snug line-clamp-2">{videoInfo.title}</p>
              {videoInfo.duration && (
                <p className="text-xs text-zinc-400 mt-1">
                  {Math.floor(videoInfo.duration / 60)}:{String(videoInfo.duration % 60).padStart(2, "0")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/40 border border-red-800/30 text-red-400 text-sm">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Format & Quality */}
        <div className="space-y-3">
          {/* Format toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Formato</label>
            <div className="flex rounded-lg bg-zinc-900 border border-zinc-800/50 p-1">
              <button
                onClick={() => setFormat("mp4")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${
                  format === "mp4"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Video size={16} /> MP4
              </button>
              <button
                onClick={() => setFormat("mp3")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${
                  format === "mp3"
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Music size={16} /> MP3
              </button>
            </div>
          </div>

          {/* Quality select */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Qualidade</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full py-2.5 px-3 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 focus:outline-none focus:border-red-500/50 transition appearance-none cursor-pointer"
            >
              {qualityOptions.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>

          {/* Output folder */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Salvar em</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                className="flex-1 py-2.5 px-3 rounded-lg bg-zinc-900 border border-zinc-700/50 text-sm text-zinc-100 focus:outline-none focus:border-red-500/50 transition"
              />
              <button
                onClick={browseFolder}
                className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 transition"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Download Button */}
        <button
          onClick={startDownload}
          disabled={!url.trim() || loading || !depsReady}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm shadow-lg shadow-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Baixando...
            </>
          ) : (
            <>
              <Download size={18} /> Baixar {format.toUpperCase()}
            </>
          )}
        </button>

        {/* Downloads list */}
        {downloads.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Downloads</h3>
            {downloads.map((d) => (
              <div
                key={d.id}
                className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/50 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-xs text-zinc-500">
                      {d.format.toUpperCase()} · {d.quality}
                    </p>
                  </div>
                  {d.status === "done" && <Check size={18} className="text-emerald-400 flex-shrink-0" />}
                  {d.status === "error" && <AlertCircle size={18} className="text-red-400 flex-shrink-0" />}
                  {(d.status === "downloading" || d.status === "processing") && (
                    <Loader2 size={18} className="animate-spin text-red-400 flex-shrink-0" />
                  )}
                </div>

                {/* Progress bar */}
                {d.status === "downloading" && (
                  <>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-500 transition-all duration-300"
                        style={{ width: `${d.percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>{d.percent.toFixed(1)}%</span>
                      {d.speed && <span>{d.speed}</span>}
                      {d.eta && <span>ETA {d.eta}</span>}
                    </div>
                  </>
                )}

                {d.status === "processing" && (
                  <p className="text-xs text-amber-400">Processando (merge/convert)...</p>
                )}

                {d.status === "error" && d.error && (
                  <p className="text-xs text-red-400">{d.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-4 py-2 border-t border-zinc-800/40 text-center">
        <p className="text-[11px] text-zinc-600">
          yt-dlp + ffmpeg · Tauri v2
        </p>
      </footer>
    </div>
  );
}
