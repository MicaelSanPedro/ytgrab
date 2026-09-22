#!/usr/bin/env bash
#
# Gera o AppImage do YTGrab (x86_64 ou ARM64).
#
#   ./scripts/build-appimage.sh              # baixa deps + compila
#   SKIP_DEPS=1 ./scripts/build-appimage.sh  # reaproveita src-tauri/bin
#
# O resultado fica em src-tauri/target/release/bundle/appimage/*.AppImage
#
# Importante: um AppImage herda a glibc da máquina que o compilou. Para o
# arquivo rodar em qualquer distro, compile na distribuição mais antiga que
# você quiser suportar (Ubuntu 22.04 => glibc 2.35). É exatamente por isso que
# a compilação oficial acontece no GitHub Actions, sobre ubuntu-22.04.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
BIN_DIR="$ROOT/src-tauri/bin"

YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"

log() { printf '\033[1;36m>>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merro:\033[0m %s\n' "$*" >&2; exit 1; }

case "$(uname -m)" in
  x86_64)  FFMPEG_ARCH="amd64" ;;
  aarch64) FFMPEG_ARCH="arm64" ;;
  *) die "arquitetura sem suporte: $(uname -m) (só x86_64 e aarch64)" ;;
esac
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"

# ---------------------------------------------------------------------------
# 1) Dependências de sistema (build do Tauri + montagem do AppImage)
# ---------------------------------------------------------------------------
if [ -z "${SKIP_SYSTEM_DEPS:-}" ] && command -v apt-get >/dev/null 2>&1; then
  log "Instalando dependências de sistema (apt)"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev squashfs-tools pkg-config \
    libfuse2 || die "falha ao instalar as dependências de sistema"
fi

command -v cargo >/dev/null 2>&1 || die "cargo não encontrado; instale o Rust (https://rustup.rs)"
command -v npm   >/dev/null 2>&1 || die "npm não encontrado"

# ---------------------------------------------------------------------------
# 2) yt-dlp e ffmpeg -> src-tauri/bin (o overlay Linux embute isso no AppImage)
# ---------------------------------------------------------------------------
if [ -z "${SKIP_DEPS:-}" ]; then
  mkdir -p "$BIN_DIR"

  if [ ! -x "$BIN_DIR/yt-dlp" ]; then
    log "Baixando yt-dlp (binário standalone, ~39 MB)"
    curl -fL --retry 3 -o "$BIN_DIR/yt-dlp" "$YTDLP_URL"
    chmod +x "$BIN_DIR/yt-dlp"
  else
    log "yt-dlp já presente em src-tauri/bin"
  fi

  if [ ! -x "$BIN_DIR/ffmpeg" ]; then
    log "Baixando ffmpeg estático (~40 MB comprimido)"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    curl -fL --retry 3 -o "$TMP_DIR/ffmpeg.tar.xz" "$FFMPEG_URL"
    tar -xf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR"
    FOUND="$(find "$TMP_DIR" -type f -name ffmpeg -perm -u+x | head -1)"
    [ -n "$FOUND" ] || die "ffmpeg não encontrado dentro do tarball"
    cp "$FOUND" "$BIN_DIR/ffmpeg"
    PROBE="$(find "$TMP_DIR" -type f -name ffprobe -perm -u+x | head -1)"
    [ -n "$PROBE" ] && cp "$PROBE" "$BIN_DIR/ffprobe"
    chmod +x "$BIN_DIR"/ffmpeg "$BIN_DIR"/ffprobe 2>/dev/null || true
  else
    log "ffmpeg já presente em src-tauri/bin"
  fi

  # O bit de execução precisa sobreviver até o bundle: sem ele o app não
  # consegue executar o binário de dentro do AppImage (montagem read-only).
  chmod +x "$BIN_DIR"/yt-dlp "$BIN_DIR"/ffmpeg 2>/dev/null || true
fi

log "Conteúdo de src-tauri/bin:"
ls -la "$BIN_DIR"
for f in yt-dlp ffmpeg; do
  [ -x "$BIN_DIR/$f" ] || die "src-tauri/bin/$f não existe ou não é executável"
done

# ---------------------------------------------------------------------------
# 3) Build
# ---------------------------------------------------------------------------
log "Instalando dependências do frontend"
npm ci

# Sem FUSE (containers, CI) o appimagetool precisa extrair a si mesmo.
export NO_STRIP=true
export APPIMAGETOOL_APP_NAME="YTGrab"

log "Compilando o AppImage (isso demora vários minutos)"
npm run tauri build -- --bundles appimage --config src-tauri/tauri.linux.conf.json

OUT="$(ls -1 "$ROOT"/src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)"
[ -n "$OUT" ] || die "o AppImage não foi gerado"

log "Pronto: $OUT"
ls -la "$OUT"
echo
echo "Para testar:  chmod +x \"$OUT\" && \"$OUT\""
