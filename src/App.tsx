import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { makeT, THEMES, LANGS, type Lang } from "./i18n";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
  author: string;
  available_heights: number[];
  audio_bitrates: number[];
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

interface UpdateInfo {
  has_update: boolean;
  latest: string;
  url: string;
}

type UpdateFreq = "always" | "weekly" | "monthly" | "off";

interface Settings {
  lang: Lang;
  theme: "dark" | "light";
  updateFreq: UpdateFreq;
  ownFolder: boolean;
  outputDir: string; // "" = usar o padrão conforme ownFolder
}

const DEFAULT_SETTINGS: Settings = {
  lang: "pt",
  theme: "dark",
  updateFreq: "weekly",
  ownFolder: true,
  outputDir: "",
};

const MP3_QUALITIES = [
  { value: "320", labelKey: "fallback320", label: "Melhor qualidade (320 kbps)" },
  { value: "190", labelKey: "fallback190", label: "Boa qualidade (190 kbps)" },
];

const MP4_QUALITIES = [
  { value: "best", label: "Melhor disponível" },
  { value: "1080", label: "Full HD (1080p)" },
  { value: "720", label: "HD (720p)" },
  { value: "480", label: "SD (480p)" },
  { value: "2160", label: "4K (2160p)" },
];

const SETTINGS_KEY = "ytgrab_settings";
const LAST_CHECK_KEY = "ytgrab_last_update_check";

function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function App() {
  const [settings, setSettings] = useState<Settings>(
    () => loadSettings() ?? DEFAULT_SETTINGS,
  );
  const [firstRun, setFirstRun] = useState(() => loadSettings() === null);
  const [showSettings, setShowSettings] = useState(firstRun);
  const [draft, setDraft] = useState<Settings>(settings);

  const t = useMemo(() => makeT(settings.lang), [settings.lang]);
  const T = THEMES[settings.theme];

  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"mp3" | "mp4">("mp3");
  const [quality, setQuality] = useState("320");
  const [outputDir, setOutputDir] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [availableHeights, setAvailableHeights] = useState<number[]>([]);
  const [audioBitrates, setAudioBitrates] = useState<number[]>([]);
  const [convertTo, setConvertTo] = useState("none");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState("");
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [platform, setPlatform] = useState("");
  const [setup, setSetup] = useState<{
    active: boolean;
    percent: number;
    message: string;
    failed: boolean;
  }>({ active: false, percent: 0, message: "", failed: false });
  const [history, setHistory] = useState<DownloadHistory[]>([]);
  const [successMsg, setSuccessMsg] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const setupRunningRef = useRef(false);
  const setupUnlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Resolve a pasta inicial conforme a configuração de pasta própria
    const initDir = async () => {
      try {
        const dir = await invoke<string>("get_default_download_dir", {
          ownFolder: settings.ownFolder,
        });
        setOutputDir(settings.outputDir || dir);
      } catch (e) {
        console.error(e);
      }
    };
    initDir();

    const boot = async () => {
      let plat = "other";
      try {
        plat = await invoke<string>("get_platform");
      } catch {}
      setPlatform(plat);
      await checkDeps(plat);
    };
    boot();

    const setupListener = async () => {
      const unlisten = await listen<DownloadProgress>("download-progress", (event) => {
        setProgress(event.payload);
      });
      unlistenRef.current = unlisten;
    };
    setupListener();

    const saved = localStorage.getItem("ytgrab_history");
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch {}
    }

    // Verificação de atualização do app, conforme a frequência configurada
    maybeCheckUpdate(settings.updateFreq);

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maybeCheckUpdate = async (freq: UpdateFreq) => {
    if (freq === "off") return;
    const now = Date.now();
    if (freq !== "always") {
      const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
      const days = freq === "weekly" ? 7 : 30;
      if (now - last < days * 24 * 3600 * 1000) return;
    }
    try {
      const info = await invoke<UpdateInfo>("check_app_update");
      localStorage.setItem(LAST_CHECK_KEY, String(now));
      if (info.has_update) setUpdateInfo(info);
    } catch (e) {
      console.error("update check:", e);
    }
  };

  const checkDeps = async (plat: string) => {
    try {
      const deps = await invoke<Record<string, boolean>>("check_dependencies");
      setYtdlpInstalled(deps["ytdlp"] || false);
      setFfmpegInstalled(deps["ffmpeg"] || false);

      if (!deps["ytdlp"] || !deps["ffmpeg"]) {
        if (plat === "android" || plat === "linux") {
          startAutoSetup();
        } else {
          setShowInstallModal(true);
        }
      }
    } catch (e) {
      console.error(e);
      if (plat === "android" || plat === "linux") {
        startAutoSetup();
      } else {
        setShowInstallModal(true);
      }
    }
  };

  const startAutoSetup = async (force = false) => {
    if (setupRunningRef.current) return;
    setupRunningRef.current = true;
    setSetup({
      active: true,
      percent: 0,
      message: "Preparando o app pela primeira vez...",
      failed: false,
    });
    try {
      const unlisten = await listen<{ stage: string; percent: number; message: string }>(
        "setup-progress",
        (e) => {
          setSetup((s) => ({ ...s, percent: e.payload.percent, message: e.payload.message }));
        },
      );
      setupUnlistenRef.current = unlisten;

      await invoke<string>("setup_dependencies", { force });

      const deps = await invoke<Record<string, boolean>>("check_dependencies");
      setYtdlpInstalled(!!deps["ytdlp"]);
      setFfmpegInstalled(!!deps["ffmpeg"]);
      setSetup({ active: true, percent: 100, message: "Tudo pronto! Abrindo o app...", failed: false });
      setTimeout(() => {
        setSetup({ active: false, percent: 0, message: "", failed: false });
        if (setupUnlistenRef.current) {
          setupUnlistenRef.current();
          setupUnlistenRef.current = null;
        }
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setSetup({ active: true, percent: 0, message: String(e ?? "desconhecido"), failed: true });
    } finally {
      setupRunningRef.current = false;
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

      const heights = info.available_heights ?? [];
      const rates = info.audio_bitrates ?? [];
      setAvailableHeights(heights);
      setAudioBitrates(rates);
      if (format === "mp4") {
        setQuality(heights.length ? String(heights[0]) : "best");
      } else {
        setQuality(rates.length ? String(rates[0]) : "320");
      }
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
        convertTo,
      });

      setSuccessMsg(result);

      const entry: DownloadHistory = {
        title: videoInfo?.title || url.trim(),
        format: convertTo !== "none" ? convertTo : format,
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
    const selected = await open({ directory: true, title: t("selectDir") });
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

  const openSettings = () => {
    setDraft({ ...settings, outputDir: outputDir });
    setShowSettings(true);
  };

  const saveSettings = async () => {
    const next = { ...draft };
    // Se a pasta estiver vazia ou for o padrão antigo, recalcula pelo toggle
    if (!next.outputDir.trim()) {
      try {
        next.outputDir = await invoke<string>("get_default_download_dir", {
          ownFolder: next.ownFolder,
        });
      } catch {}
    }
    setSettings(next);
    setOutputDir(next.outputDir);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (firstRun) setFirstRun(false);
    setShowSettings(false);
  };

  const qualities =
    format === "mp3"
      ? audioBitrates.length
        ? audioBitrates.map((b, i) => ({
            value: String(b),
            label: i === 0 ? `${t("maxOfSource")} (${b} kbps)` : `${b} kbps`,
          }))
        : MP3_QUALITIES
      : availableHeights.length
        ? [
            { value: "best", label: t("bestAvailable") },
            ...availableHeights.map((h, i) => ({
              value: String(h),
              label: `${h}p${
                i === 0
                  ? ` (${t("maxOfVideo")})`
                  : h >= 2160
                    ? " (4K)"
                    : h >= 1080
                      ? " (Full HD)"
                      : h >= 720
                        ? " (HD)"
                        : ""
              }`,
            })),
          ]
        : MP4_QUALITIES;

  const labelStyle = { fontSize: 12, color: T.sub, display: "block", marginBottom: 4 } as const;
  const selectStyle = {
    width: "100%",
    padding: 8,
    borderRadius: 8,
    background: T.inputBg,
    color: T.text,
    border: `1px solid ${T.border}`,
    fontSize: 13,
    boxSizing: "border-box",
  } as const;

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 16,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: T.text,
        background: T.bg,
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20, position: "relative" }}>
        <h1 style={{ margin: 0, fontSize: 28, color: T.accent }}>YTGrab</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: T.sub }}>{t("tagline")}</p>
        <button
          onClick={openSettings}
          title={t("settings")}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            background: "none",
            border: "none",
            fontSize: 18,
            cursor: "pointer",
            color: T.sub,
          }}
        >
          ⚙
        </button>
      </div>

      {/* Update banner */}
      {updateInfo?.has_update && (
        <div
          style={{
            background: T.okBg,
            border: `1px solid ${T.warn}`,
            borderRadius: 8,
            padding: 10,
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: T.text }}>
             {t("updateAvailable")} <strong>v{updateInfo.latest}</strong>
          </span>
          <button
            onClick={() => openUrl(updateInfo.url).catch(console.error)}
            style={{
              background: T.blue,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("viewRelease")}
          </button>
        </div>
      )}

      {/* Settings screen (first run or via ⚙) */}
      {showSettings && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 16,
          }}
        >
          <div
            style={{
              background: T.card,
              borderRadius: 12,
              padding: 20,
              maxWidth: 420,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              color: T.text,
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18, color: T.accent }}>
              {firstRun ? t("firstRunTitle") : t("settingsTitle")}
            </h2>
            {firstRun && (
              <p style={{ fontSize: 12, color: T.sub, marginTop: -8 }}>{t("firstRunHint")}</p>
            )}

            <label style={labelStyle}>{t("language")}</label>
            <select
              value={draft.lang}
              onChange={(e) => setDraft({ ...draft, lang: e.target.value as Lang })}
              style={selectStyle}
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>

            <div style={{ height: 12 }} />
            <label style={labelStyle}>{t("theme")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["dark", "light"] as const).map((th) => (
                <button
                  key={th}
                  onClick={() => setDraft({ ...draft, theme: th })}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRadius: 8,
                    background: draft.theme === th ? T.accent : T.card,
                    color: draft.theme === th ? "#fff" : T.text,
                    border: `2px solid ${draft.theme === th ? T.accent : T.border}`,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {th === "dark" ? "🌙 " + t("themeDark") : "☀ " + t("themeLight")}
                </button>
              ))}
            </div>

            <div style={{ height: 12 }} />
            <label style={labelStyle}>{t("updateCheck")}</label>
            <select
              value={draft.updateFreq}
              onChange={(e) => setDraft({ ...draft, updateFreq: e.target.value as UpdateFreq })}
              style={selectStyle}
            >
              <option value="always">{t("freqAlways")}</option>
              <option value="weekly">{t("freqWeekly")}</option>
              <option value="monthly">{t("freqMonthly")}</option>
              <option value="off">{t("freqOff")}</option>
            </select>

            <div style={{ height: 12 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={draft.ownFolder}
                onChange={(e) => setDraft({ ...draft, ownFolder: e.target.checked, outputDir: "" })}
              />
              {t("ownFolder")}
            </label>
            <label style={{ ...labelStyle, marginTop: 8 }}>{t("downloadFolder")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={draft.outputDir}
                onChange={(e) => setDraft({ ...draft, outputDir: e.target.value })}
                placeholder={draft.ownFolder ? "~/Downloads/YTGrab" : "~/Downloads"}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 8,
                  background: T.inputBg,
                  color: T.text,
                  border: `1px solid ${T.border}`,
                  fontSize: 12,
                }}
              />
              <button
                onClick={async () => {
                  const sel = await open({ directory: true, title: t("selectDir") });
                  if (sel) setDraft({ ...draft, outputDir: sel as string });
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: T.blue,
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                📁
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={saveSettings}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  background: T.ok,
                  color: "#fff",
                  border: "none",
                  fontSize: 14,
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                ✓ {t("save")}
              </button>
              {!firstRun && (
                <button
                  onClick={() => setShowSettings(false)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: T.card,
                    color: T.text,
                    border: `1px solid ${T.border}`,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {t("close")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* First-run auto-setup */}
      {setup.active && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: 16,
          }}
        >
          <div
            style={{
              background: T.card,
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: "100%",
              textAlign: "center",
            }}
          >
            <h2 style={{ color: T.accent, marginTop: 0, fontSize: 20 }}>
              {setup.failed ? "Não foi possível preparar o app" : "Configurando o app..."}
            </h2>

            {!setup.failed && (
              <>
                <p style={{ fontSize: 13, color: T.text, lineHeight: 1.5, minHeight: 20 }}>
                  {setup.message}
                </p>
                <div
                  style={{
                    width: "100%",
                    height: 6,
                    background: T.border,
                    borderRadius: 3,
                    overflow: "hidden",
                    margin: "14px 0 6px",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, setup.percent))}%`,
                      height: "100%",
                      background: T.accent,
                      transition: "width 0.3s",
                    }}
                  />
                </div>
                <p style={{ fontSize: 11, color: T.sub }}>
                  {platform === "linux"
                    ? "Só na primeira vez: o app baixa o yt-dlp e o ffmpeg (cerca de 120 MB) e se prepara sozinho, sem nenhuma etapa manual."
                    : "Só na primeira vez: o app baixa Python + ffmpeg (cerca de 40–60 MB) e se prepara sozinho, sem nenhuma etapa manual."}
                </p>
              </>
            )}

            {setup.failed && (
              <>
                <p style={{ fontSize: 12, color: "#ff9f9f", wordBreak: "break-word", lineHeight: 1.5 }}>
                  {setup.message}
                </p>
                <button
                  onClick={() => startAutoSetup()}
                  style={{
                    background: T.ok,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 32px",
                    fontSize: 14,
                    cursor: "pointer",
                    marginTop: 8,
                  }}
                >
                  Tentar novamente
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Install Modal (Windows) */}
      {showInstallModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: T.card,
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: "90%",
              textAlign: "center",
            }}
          >
            <h2 style={{ color: T.accent, marginTop: 0 }}>Instalar Dependências</h2>
            <p style={{ fontSize: 13, color: T.sub, lineHeight: 1.5 }}>
              O YTGrab precisa do <strong style={{ color: T.text }}>yt-dlp</strong> e do{" "}
              <strong style={{ color: T.text }}>ffmpeg</strong> para funcionar.
            </p>

            <div style={{ margin: "16px 0" }}>
              <button
                onClick={handleInstallYtdlp}
                disabled={installing || ytdlpInstalled}
                style={{
                  background: ytdlpInstalled ? T.ok : T.accent,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 24px",
                  fontSize: 14,
                  cursor: "pointer",
                  margin: 4,
                  opacity: installing || ytdlpInstalled ? 0.7 : 1,
                }}
              >
                {ytdlpInstalled ? "✓ yt-dlp Instalado" : "Instalar yt-dlp"}
              </button>
              <button
                onClick={handleInstallFfmpeg}
                disabled={installing || ffmpegInstalled}
                style={{
                  background: ffmpegInstalled ? T.ok : T.accent2,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 24px",
                  fontSize: 14,
                  cursor: "pointer",
                  margin: 4,
                  opacity: installing || ffmpegInstalled ? 0.7 : 1,
                }}
              >
                {ffmpegInstalled ? "✓ ffmpeg Instalado" : "Instalar ffmpeg"}
              </button>
            </div>

            {installMsg && <p style={{ fontSize: 12, color: T.sub, margin: "8px 0" }}>{installMsg}</p>}

            {installing && (
              <div style={{ margin: "8px 0" }}>
                <div
                  style={{
                    width: "100%",
                    height: 4,
                    background: T.border,
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "40%",
                      height: "100%",
                      background: T.accent,
                      animation: "pulse 1.5s infinite",
                    }}
                  />
                </div>
                <p style={{ fontSize: 11, color: T.sub, marginTop: 4 }}>Baixando...</p>
              </div>
            )}

            {ytdlpInstalled && ffmpegInstalled && (
              <button
                onClick={() => setShowInstallModal(false)}
                style={{
                  background: T.ok,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 32px",
                  fontSize: 14,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                Continuar →
              </button>
            )}

            {ytdlpInstalled && !ffmpegInstalled && (
              <p style={{ fontSize: 11, color: T.warn, marginTop: 8 }}>
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
          placeholder={t("urlPlaceholder")}
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.inputBg,
            color: T.text,
            fontSize: 14,
            boxSizing: "border-box",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleGetInfo()}
        />
      </div>

      {/* Get Info Button */}
      <button
        onClick={handleGetInfo}
        disabled={loading || !url.trim()}
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 8,
          background: loading ? T.sub : T.blue,
          color: "#fff",
          border: "none",
          fontSize: 14,
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: 12,
        }}
      >
        {loading ? t("loading") : t("getInfo")}
      </button>

      {/* Video Preview */}
      {videoInfo && (
        <div
          style={{
            background: T.card,
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
            display: "flex",
            gap: 12,
          }}
        >
          {videoInfo.thumbnail && (
            <img
              src={videoInfo.thumbnail}
              alt=""
              style={{ width: 100, height: 70, borderRadius: 6, objectFit: "cover" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: "bold",
                lineHeight: 1.3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {videoInfo.title}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: T.sub }}>
              {videoInfo.author} • {videoInfo.duration}
            </p>
          </div>
        </div>
      )}

      {/* Format Toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => {
            setFormat("mp3");
            setConvertTo("none");
            setQuality(audioBitrates.length ? String(audioBitrates[0]) : "320");
          }}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            background: format === "mp3" ? T.accent : T.card,
            color: "#fff",
            border: format === "mp3" ? `2px solid ${T.accent}` : `2px solid ${T.border}`,
            fontSize: 14,
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          🎵 MP3
        </button>
        <button
          onClick={() => {
            setFormat("mp4");
            setConvertTo("none");
            setQuality(availableHeights.length ? String(availableHeights[0]) : "best");
          }}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            background: format === "mp4" ? T.accent2 : T.card,
            color: "#fff",
            border: format === "mp4" ? `2px solid ${T.accent2}` : `2px solid ${T.border}`,
            fontSize: 14,
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          🎬 MP4
        </button>
      </div>

      {/* Quality Select */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t("quality")}</label>
        <select value={quality} onChange={(e) => setQuality(e.target.value)} style={selectStyle}>
          {qualities.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </div>

      {/* Post-download conversion */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t("convertTo")}</label>
        <select value={convertTo} onChange={(e) => setConvertTo(e.target.value)} style={selectStyle}>
          <option value="none">
            {t("noConvert")} {format.toUpperCase()})
          </option>
          {(format === "mp4" ? ["mkv", "webm", "mp3", "m4a", "opus", "wav"] : ["m4a", "opus", "wav"]).map(
            (tf) => (
              <option key={tf} value={tf}>
                .{tf.toUpperCase()}
              </option>
            ),
          )}
        </select>
        {convertTo !== "none" && (
          <p style={{ fontSize: 11, color: T.sub, margin: "4px 0 0" }}>{t("convertHint")}</p>
        )}
      </div>

      {/* Output Directory */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>{t("saveIn")}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 8,
              background: T.inputBg,
              color: T.text,
              border: `1px solid ${T.border}`,
              fontSize: 12,
            }}
          />
          <button
            onClick={handleSelectDir}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: T.blue,
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            📁
          </button>
        </div>
        <button
          onClick={handleOpenDir}
          style={{
            background: "none",
            border: "none",
            color: T.accent,
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
            marginTop: 4,
          }}
        >
          {t("openFolder")}
        </button>
      </div>

      {/* Download Button */}
      <button
        onClick={handleDownload}
        disabled={downloading || !url.trim() || !outputDir}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 10,
          background: downloading ? T.sub : `linear-gradient(135deg, ${T.accent}, ${T.accent2})`,
          color: "#fff",
          border: "none",
          fontSize: 16,
          fontWeight: "bold",
          cursor: downloading ? "not-allowed" : "pointer",
          marginBottom: 12,
        }}
      >
        {downloading
          ? progress?.stage === "converting"
            ? t("converting")
            : t("downloading")
          : convertTo !== "none"
            ? `${t("downloadAndConvert")} ${convertTo.toUpperCase()}`
            : `${t("download")} ${format.toUpperCase()}`}
      </button>

      {/* Progress Bar */}
      {(downloading || progress) && progress && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              width: "100%",
              height: 8,
              background: T.border,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 4,
            }}
          >
            <div
              style={{
                width: `${Math.min(progress.percentage, 100)}%`,
                height: "100%",
                background:
                  progress.stage === "converting"
                    ? T.warn
                    : progress.percentage >= 100
                      ? T.ok
                      : T.accent,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.sub }}>
            <span>
              {progress.stage === "starting"
                ? t("starting")
                : progress.stage === "converting"
                  ? t("convertingAudio")
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
        <div
          style={{
            background: T.okBg,
            borderRadius: 8,
            padding: 10,
            marginBottom: 12,
            border: `1px solid ${T.ok}`,
          }}
        >
          <p style={{ margin: 0, color: T.ok, fontSize: 13 }}>✓ {successMsg}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          style={{
            background: T.errBg,
            borderRadius: 8,
            padding: 10,
            marginBottom: 12,
            border: `1px solid ${T.accent2}`,
          }}
        >
          <p style={{ margin: 0, color: T.err, fontSize: 13 }}>✗ {error}</p>
        </div>
      )}

      {/* Download History */}
      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, color: T.sub, marginBottom: 8 }}>{t("history")}</h3>
          <div style={{ maxHeight: 200, overflow: "auto" }}>
            {history.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  background: T.card,
                  borderRadius: 6,
                  marginBottom: 4,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "70%",
                  }}
                >
                  {item.title}
                </span>
                <span style={{ color: T.sub, flexShrink: 0 }}>.{item.format}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reinstall button */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          onClick={() => {
            if (platform === "android") startAutoSetup();
            else if (platform === "linux") startAutoSetup(true);
            else setShowInstallModal(true);
          }}
          style={{
            background: "none",
            border: "none",
            color: T.sub,
            fontSize: 11,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {t("reinstall")}
        </button>
      </div>
    </div>
  );
}

export default App;
