// Idiomas suportados: para adicionar um novo, basta incluir um novo
// dicionário aqui e uma opção no seletor de idioma da tela de configurações.
export type Lang = "pt" | "en";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "pt", label: "Português (Brasil)" },
  { value: "en", label: "English" },
];

type Dict = Record<string, string>;

const pt: Dict = {
  tagline: "Baixe vídeos e músicas do YouTube",
  urlPlaceholder: "Cole o link do YouTube aqui...",
  getInfo: "🔍 Buscar Informações",
  loading: "Carregando...",
  quality: "Qualidade:",
  bestAvailable: "Melhor disponível",
  maxOfVideo: "máxima do vídeo",
  maxOfSource: "Máxima da fonte",
  convertTo: "Converter para:",
  noConvert: "Não converter (manter",
  convertHint:
    "🔁 Depois de baixar, o ffmpeg embutido converte o arquivo para o formato escolhido.",
  saveIn: "Salvar em:",
  selectDir: "Selecionar pasta de downloads",
  openFolder: "Abrir pasta →",
  download: "⬇ Baixar",
  downloadAndConvert: "⬇ Baixar e converter p/",
  downloading: "⏳ Baixando...",
  converting: "⏳ Convertendo...",
  starting: "Iniciando...",
  convertingAudio: "Convertendo áudio...",
  history: "📜 Histórico",
  reinstall: "Reinstalar dependências",
  settings: "Configurações",
  settingsTitle: "⚙ Configurações",
  language: "Idioma",
  theme: "Tema",
  themeDark: "Escuro",
  themeLight: "Claro",
  updateCheck: "Verificar atualizações do app",
  freqAlways: "Sempre que abrir",
  freqWeekly: "Semanalmente (recomendado)",
  freqMonthly: "Mensalmente",
  freqOff: "Desativado",
  downloadFolder: "Onde baixar os arquivos",
  ownFolder: "Criar pasta própria (Downloads/YTGrab)",
  save: "Salvar",
  close: "Fechar",
  updateAvailable: "Nova versão disponível:",
  viewRelease: "Ver release →",
  checkingUpdate: "Verificando atualizações...",
  firstRunTitle: "Bem-vindo! Configure o YTGrab",
  firstRunHint: "Você pode mudar tudo depois no botão ⚙.",
};

const en: Dict = {
  tagline: "Download YouTube videos and music",
  urlPlaceholder: "Paste the YouTube link here...",
  getInfo: "🔍 Fetch Info",
  loading: "Loading...",
  quality: "Quality:",
  bestAvailable: "Best available",
  maxOfVideo: "video max",
  maxOfSource: "Source max",
  convertTo: "Convert to:",
  noConvert: "Don't convert (keep",
  convertHint:
    "🔁 After downloading, the bundled ffmpeg converts the file to the chosen format.",
  saveIn: "Save to:",
  selectDir: "Select downloads folder",
  openFolder: "Open folder →",
  download: "⬇ Download",
  downloadAndConvert: "⬇ Download & convert to",
  downloading: "⏳ Downloading...",
  converting: "⏳ Converting...",
  starting: "Starting...",
  convertingAudio: "Converting audio...",
  history: "📜 History",
  reinstall: "Reinstall dependencies",
  settings: "Settings",
  settingsTitle: "⚙ Settings",
  language: "Language",
  theme: "Theme",
  themeDark: "Dark",
  themeLight: "Light",
  updateCheck: "Check for app updates",
  freqAlways: "Every time it opens",
  freqWeekly: "Weekly (recommended)",
  freqMonthly: "Monthly",
  freqOff: "Disabled",
  downloadFolder: "Where to save files",
  ownFolder: "Create own folder (Downloads/YTGrab)",
  save: "Save",
  close: "Close",
  updateAvailable: "New version available:",
  viewRelease: "View release →",
  checkingUpdate: "Checking for updates...",
  firstRunTitle: "Welcome! Set up YTGrab",
  firstRunHint: "You can change everything later with the ⚙ button.",
};

const DICTS: Record<Lang, Dict> = { pt, en };

export function makeT(lang: Lang) {
  return (key: string): string => DICTS[lang]?.[key] ?? DICTS.pt[key] ?? key;
}

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------
export interface Theme {
  bg: string;
  card: string;
  text: string;
  sub: string;
  border: string;
  accent: string;   // rosa principal
  accent2: string;  // rosa secundário (aba MP4)
  blue: string;     // botões azuis
  ok: string;
  warn: string;
  err: string;
  inputBg: string;
  okBg: string;
  errBg: string;
}

export const THEMES: Record<"dark" | "light", Theme> = {
  dark: {
    bg: "#1a1a2e",
    card: "#16213e",
    text: "#e0e0e0",
    sub: "#888",
    border: "#333",
    accent: "#ff6b6b",
    accent2: "#e94560",
    blue: "#0f3460",
    ok: "#2ecc71",
    warn: "#ffa502",
    err: "#ff6b6b",
    inputBg: "#16213e",
    okBg: "#1a3a2a",
    errBg: "#3a1a1a",
  },
  light: {
    bg: "#f4f4f8",
    card: "#ffffff",
    text: "#22223a",
    sub: "#666",
    border: "#d5d5e0",
    accent: "#e94560",
    accent2: "#c73652",
    blue: "#274b8f",
    ok: "#1e9e57",
    warn: "#c77800",
    err: "#d0343f",
    inputBg: "#ffffff",
    okBg: "#e2f6ea",
    errBg: "#fbe7e8",
  },
};
