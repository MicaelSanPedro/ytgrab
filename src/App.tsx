import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
}

interface DownloadProgress {
  percentage: number;
  speed: string;
  eta: string;
  stage: string;
}

interface DownloadHistory {
  title: string;
  format: string;
  timestamp: string;
}

const MP3_QUALITIES = [
  { value: "0", label: "Melhor qualidade (320kbps)" },
  { value: "2", label: "Boa qualidade (190kbps)" },
];

const MP4_QUALITIES = [
  { value: "best", label: "Melhor disponível" },
  { value: "1080", label: "Full HD (1080p)" },
  { value: "720", label: "HD (720p)" },
  { value: "480", label: "SD (480p)" },
  { value: "2160", label: "4K (2160p)" },
];

function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp3" | "mp4">("mp3");
  const [quality, setQuality] = useState("0");
  const [outputDir, setOutputDir] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [history, setHistory] = useState<DownloadHistory[]>([]);
  const [successMsg, setSuccessMsg] = useState("");
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Load default download dir
    invoke<string>("get_default_download_dir").then(setOutputDir).catch(console.error);

    // Check dependencies
    checkDeps();

    // Listen for progress events
    const setupListener = async () => {
      const unlisten = await listen<DownloadProgress>("download-progress", (event) => {
        setProgress(event.payload);
      });
      unlistenRef.current = unlisten;
    };
    setupListener();

    // Load history from localStorage
    const saved = localStorage.getItem("ytgrab_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch {}
    }

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const checkDeps = async () => {
    try {
      const deps = await invoke<Record<string, boolean>>("check_dependencies");
      setYtdlpInstalled(deps["ytdlp"] || false);
      setFfmpegInstalled(deps["ffmpeg"] || false);

      if (!deps["ytdlp"] || !deps["ffmpeg"]) {
        setShowInstallModal(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleInstallYtdlp = async () => {
    setInstalling(true);
    setInstallMsg("Baixando yt-dlp...");
    try {
      const result = await invoke<string>("install_ytdlp");
      setInstallMsg(result);
      setYtdlpInstalled(true);
    } catch (e: any) {
      setInstallMsg(`Erro: ${e}`);
    }
    setInstalling(false);
  };

  const handleInstallFfmpeg = async () => {
    setInstalling(true);
    setInstallMsg("Baixando ffmpeg... (pode demorar)");
    try {
      const result = await invoke<string>("install_ffmpeg");
      setInstallMsg(result);
      setFfmpegInstalled(true);
    } catch (e: any) {
      setInstallMsg(`Erro: ${e}`);
    }
    setInstalling(false);
  };

  const handleGetInfo = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setVideoInfo(null);

    try {
      const info = await invoke<VideoInfo>("get_video_info", { url: url.trim() });
      setVideoInfo(info);
    } catch (e: any) {
      setError(e.toString());
    }
    setLoading(false);
  };

  const handleDownload = async () => {
    if (!url.trim() || !outputDir) return;

    setDownloading(true);
    setError("");
    setSuccessMsg("");
    setProgress({ percentage: 0, speed: "", eta: "", stage: "starting" });

    try {
      const result = await invoke<string>("download", {
        url: url.trim(),
        format,
        quality,
        outputDir,
      });

      setSuccessMsg(result);

      // Add to history
      const entry: DownloadHistory = {
        title: videoInfo?.title || url.trim(),
        format,
        timestamp: new Date().toLocaleString("pt-BR"),
      };
      const newHistory = [entry, ...history].slice(0, 20);
      setHistory(newHistory);
      localStorage.setItem("ytgrab_history", JSON.stringify(newHistory));
    } catch (e: any) {
      setError(e.toString());
    }

    setDownloading(false);
  };

  const handleSelectDir = async () => {
    const selected = await open({ directory: true, title: "Selecionar pasta de downloads" });
    if (selected) {
      setOutputDir(selected as string);
    }
  };

  const handleOpenDir = async () => {
    if (outputDir) {
      try {
        await invoke("open_in_file_manager", { path: outputDir });
      } catch {}
    }
  };

  const qualities = format === "mp3" ? MP3_QUALITIES : MP4_QUALITIES;

  return (
    <div style={{
      maxWidth: 480,
      margin: "0 auto",
      padding: 16,
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#e0e0e0",
      background: "#1a1a2e",
      minHeight: "100vh",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: "#ff6b6b" }}>YTGrab</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Baixe vídeos e músicas do YouTube</p>
      </div>

      {/* Install Modal */}
      {showInstallModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.8)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            background: "#16213e", borderRadius: 12, padding: 24,
            maxWidth: 400, width: "90%", textAlign: "center",
          }}>
            <h2 style={{ color: "#ff6b6b", marginTop: 0 }}>Instalar Dependências</h2>
            <p style={{ fontSize: 13, color: "#aaa", lineHeight: 1.5 }}>
              O YTGrab precisa do <strong style={{color:"#fff"}}>yt-dlp</strong> e do <strong style={{color:"#fff"}}>ffmpeg</strong> para funcionar.
            </p>

            <div style={{ margin: "16px 0" }}>
              <button
                onClick={handleInstallYtdlp}
                disabled={installing || ytdlpInstalled}
                style={{
                  background: ytdlpInstalled ? "#2ecc71" : "#ff6b6b",
                  color: "#fff", border: "none", borderRadius: 8,
                  padding: "10px 24px", fontSize: 14, cursor: "pointer",
                  margin: 4, opacity: (installing || ytdlpInstalled) ? 0.7 : 1,
                }}
              >
                {ytdlpInstalled ? "✓ yt-dlp Instalado" : "Instalar yt-dlp"}
              </button>
              <button
                onClick={handleInstallFfmpeg}
                disabled={installing || ffmpegInstalled}
                style={{
                  background: ffmpegInstalled ? "#2ecc71" : "#e94560",
                  color: "#fff", border: "none", borderRadius: 8,
                  padding: "10px 24px", fontSize: 14, cursor: "pointer",
                  margin: 4, opacity: (installing || ffmpegInstalled) ? 0.7 : 1,
                }}
              >
                {ffmpegInstalled ? "✓ ffmpeg Instalado" : "Instalar ffmpeg"}
              </button>
            </div>

            {installMsg && (
              <p style={{ fontSize: 12, color: "#aaa", margin: "8px 0" }}>{installMsg}</p>
            )}

            {installing && (
              <div style={{ margin: "8px 0" }}>
                <div style={{
                  width: "100%", height: 4, background: "#333",
                  borderRadius: 2, overflow: "hidden",
                }}>
                  <div style={{
                    width: "40%", height: "100%", background: "#ff6b6b",
                    animation: "pulse 1.5s infinite",
                  }} />
                </div>
                <p style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Baixando...</p>
              </div>
            )}

            {ytdlpInstalled && ffmpegInstalled && (
              <button
                onClick={() => setShowInstallModal(false)}
                style={{
                  background: "#2ecc71", color: "#fff", border: "none",
                  borderRadius: 8, padding: "10px 32px", fontSize: 14,
                  cursor: "pointer", marginTop: 8,
                }}
              >
                Continuar →
              </button>
            )}

            {ytdlpInstalled && !ffmpegInstalled && (
              <p style={{ fontSize: 11, color: "#ffaa00", marginTop: 8 }}>
                ffmpeg é necessário para converter áudio e mesclar vídeo.
              </p>
            )}
          </div>
        </div>
      )}

      {/* URL Input */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Cole o link do YouTube aqui..."
          style={{
            width: "100%", padding: "10px 14px", borderRadius: 8,
            border: "1px solid #333", background: "#16213e",
            color: "#fff", fontSize: 14, boxSizing: "border-box",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleGetInfo()}
        />
      </div>

      {/* Get Info Button */}
      <button
        onClick={handleGetInfo}
        disabled={loading || !url.trim()}
        style={{
          width: "100%", padding: 10, borderRadius: 8,
          background: loading ? "#555" : "#0f3460",
          color: "#fff", border: "none", fontSize: 14,
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: 12,
        }}
      >
        {loading ? "Carregando..." : "🔍 Buscar Informações"}
      </button>

      {/* Video Preview */}
      {videoInfo && (
        <div style={{
          background: "#16213e", borderRadius: 10, padding: 12,
          marginBottom: 12, display: "flex", gap: 12,
        }}>
          {videoInfo.thumbnail && (
            <img
              src={videoInfo.thumbnail}
              alt=""
              style={{ width: 100, height: 70, borderRadius: 6, objectFit: "cover" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: "bold", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {videoInfo.title}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#888" }}>
              {videoInfo.author} • {videoInfo.duration}
            </p>
          </div>
        </div>
      )}

      {/* Format Toggle */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 12,
      }}>
        <button
          onClick={() => { setFormat("mp3"); setQuality("0"); }}
          style={{
            flex: 1, padding: 10, borderRadius: 8,
            background: format === "mp3" ? "#ff6b6b" : "#16213e",
            color: "#fff", border: format === "mp3" ? "2px solid #ff6b6b" : "2px solid #333",
            fontSize: 14, fontWeight: "bold", cursor: "pointer",
          }}
        >
          🎵 MP3
        </button>
        <button
          onClick={() => { setFormat("mp4"); setQuality("best"); }}
          style={{
            flex: 1, padding: 10, borderRadius: 8,
            background: format === "mp4" ? "#e94560" : "#16213e",
            color: "#fff", border: format === "mp4" ? "2px solid #e94560" : "2px solid #333",
            fontSize: 14, fontWeight: "bold", cursor: "pointer",
          }}
        >
          🎬 MP4
        </button>
      </div>

      {/* Quality Select */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>
          Qualidade:
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          style={{
            width: "100%", padding: 8, borderRadius: 8,
            background: "#16213e", color: "#fff",
            border: "1px solid #333", fontSize: 13,
          }}
        >
          {qualities.map((q) => (
            <option key={q.value} value={q.value}>{q.label}</option>
          ))}
        </select>
      </div>

      {/* Output Directory */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>
          Salvar em:
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            style={{
              flex: 1, padding: 8, borderRadius: 8,
              background: "#16213e", color: "#fff",
              border: "1px solid #333", fontSize: 12,
            }}
          />
          <button
            onClick={handleSelectDir}
            style={{
              padding: "8px 12px", borderRadius: 8,
              background: "#0f3460", color: "#fff",
              border: "none", cursor: "pointer", fontSize: 13,
            }}
          >
            📁
          </button>
        </div>
        <button
          onClick={handleOpenDir}
          style={{
            background: "none", border: "none",
            color: "#ff6b6b", fontSize: 11,
            cursor: "pointer", padding: 0, marginTop: 4,
          }}
        >
          Abrir pasta →
        </button>
      </div>

      {/* Download Button */}
      <button
        onClick={handleDownload}
        disabled={downloading || !url.trim() || !outputDir}
        style={{
          width: "100%", padding: 12, borderRadius: 10,
          background: downloading ? "#555" : "linear-gradient(135deg, #ff6b6b, #e94560)",
          color: "#fff", border: "none", fontSize: 16,
          fontWeight: "bold", cursor: downloading ? "not-allowed" : "pointer",
          marginBottom: 12,
        }}
      >
        {downloading
          ? progress?.stage === "converting"
            ? "⏳ Convertendo..."
            : "⏳ Baixando..."
          : `⬇ Baixar ${format.toUpperCase()}`}
      </button>

      {/* Progress Bar */}
      {(downloading || progress) && progress && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            width: "100%", height: 8, background: "#333",
            borderRadius: 4, overflow: "hidden", marginBottom: 4,
          }}>
            <div style={{
              width: `${Math.min(progress.percentage, 100)}%`,
              height: "100%",
              background: progress.stage === "converting"
                ? "#ffa502"
                : progress.percentage >= 100
                  ? "#2ecc71"
                  : "#ff6b6b",
              transition: "width 0.3s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888" }}>
            <span>
              {progress.stage === "starting"
                ? "Iniciando..."
                : progress.stage === "converting"
                  ? "Convertendo áudio..."
                  : `${progress.percentage.toFixed(1)}%`}
            </span>
            <span>
              {progress.speed && `${progress.speed}`}
              {progress.eta && ` • ETA: ${progress.eta}`}
            </span>
          </div>
        </div>
      )}

      {/* Success Message */}
      {successMsg && (
        <div style={{
          background: "#1a3a2a", borderRadius: 8, padding: 10,
          marginBottom: 12, border: "1px solid #2ecc71",
        }}>
          <p style={{ margin: 0, color: "#2ecc71", fontSize: 13 }}>✓ {successMsg}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div style={{
          background: "#3a1a1a", borderRadius: 8, padding: 10,
          marginBottom: 12, border: "1px solid #e94560",
        }}>
          <p style={{ margin: 0, color: "#ff6b6b", fontSize: 13 }}>✗ {error}</p>
        </div>
      )}

      {/* Download History */}
      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8 }}>
            📜 Histórico
          </h3>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {history.map((item, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between",
                padding: "6px 8px", background: "#16213e",
                borderRadius: 6, marginBottom: 4, fontSize: 12,
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                  {item.title}
                </span>
                <span style={{ color: "#888", flexShrink: 0 }}>
                  .{item.format}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reinstall button */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          onClick={() => setShowInstallModal(true)}
          style={{
            background: "none", border: "none",
            color: "#555", fontSize: 11, cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Reinstalar dependências
        </button>
      </div>
    </div>
  );
}

export default App;
