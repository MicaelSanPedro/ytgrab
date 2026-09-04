export type VideoInfo = {
  title: string;
  thumbnail: string;
  duration: number | null;
  formats: FormatInfo[];
};

export type FormatInfo = {
  format_id: string;
  ext: string;
  resolution: string | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  tbr: number | null;
  abr: number | null;
  vbr: number | null;
  filesize: number | null;
};

export type DownloadOptions = {
  url: string;
  format: string;
  quality: string;
  output_dir: string;
  filename: string;
};

export type DownloadProgress = {
  id: string;
  percent: number;
  speed: string;
  eta: string;
  status: "downloading" | "processing" | "done" | "error";
  error: string | null;
};

export type DownloadItem = {
  id: string;
  url: string;
  title: string;
  format: string;
  quality: string;
  percent: number;
  speed: string;
  eta: string;
  status: "downloading" | "processing" | "done" | "error";
  error: string | null;
};

export const AUDIO_QUALITIES = [
  { value: "best", label: "Melhor VBR" },
  { value: "320", label: "320 kbps" },
  { value: "256", label: "256 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "128", label: "128 kbps" },
];

export const VIDEO_QUALITIES = [
  { value: "2160", label: "4K (2160p)" },
  { value: "1440", label: "2K (1440p)" },
  { value: "1080", label: "Full HD (1080p)" },
  { value: "720", label: "HD (720p)" },
  { value: "480", label: "SD (480p)" },
  { value: "360", label: "Baixo (360p)" },
];
