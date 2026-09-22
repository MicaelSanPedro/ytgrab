<div align="center">

# 🎬 YTGrab

**Baixe vídeos e músicas do YouTube em alta qualidade — simples, rápido e de código aberto.**

[![Release](https://img.shields.io/github/v/release/MicaelSanPedro/ytgrab?label=versão&color=3b82f6)](https://github.com/MicaelSanPedro/ytgrab/releases)
[![Downloads](https://img.shields.io/github/downloads/MicaelSanPedro/ytgrab/total?color=22c55e)](https://github.com/MicaelSanPedro/ytgrab/releases)
![Plataformas](https://img.shields.io/badge/plataformas-Linux%20%7C%20Windows-blue)

</div>

---

## ⬇️ Downloads

| | |
|---|---|
| 🌐 **Site (beta)** | [ytgrab em github.io](https://micaelsanpedro.github.io/ytgrab/) — use direto no navegador (código em [`site/`](site)) |

Baixe sempre a versão mais recente na [página de releases](https://github.com/MicaelSanPedro/ytgrab/releases):

| Sistema | Arquivo | Como instalar |
|---|---|---|
| 🐧 **Linux** | `YTGrab_x.y.z_amd64.AppImage` | Veja o passo a passo abaixo ↓ |
| 🪟 **Windows** | `YTGrab_x.y.z_x64-setup.exe` | Dê dois cliques e siga o instalador |

> 📱 **Android?** O app para celular agora mora em outro repositório:
> **[MicaelSanPedro/TuneGrab](https://github.com/MicaelSanPedro/TuneGrab)** 🎵

---

## 🐧 Instalando no Linux

### Opção 1 — Gear Lever (recomendado, sem terminal)

O [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) é um gerenciador de
AppImages: você arrasta o arquivo para dentro dele e o YTGrab aparece no menu de
aplicativos do sistema, com ícone e tudo — além de avisar quando sair atualização.

1. Instale o Gear Lever pela sua loja de aplicativos (Flathub) ou com:
   ```bash
   flatpak install flathub it.mijorus.gearlever
   ```
2. Abra o Gear Lever e **arraste o AppImage do YTGrab** para a janela dele.
3. Pronto! O YTGrab já vai estar no seu menu de aplicativos. 🎉

🎥 **Prefere um vídeo?** O Diolinux Labs explica tudo passo a passo:
[Agora é mais fácil integrar os AppImages no seu Linux!](https://youtu.be/WL2oK520kVE)

### Opção 2 — Terminal

```bash
chmod +x YTGrab_x.y.z_amd64.AppImage
./YTGrab_x.y.z_amd64.AppImage
```

Requer glibc 2.34+ (Ubuntu 22.04+, Debian 12+, Fedora 36+). Se a sua distro não
tiver FUSE: `sudo apt install libfuse2` ou rode com `--appimage-extract-and-run`.

---

## ✨ Recursos

- 🎞️ **Qualidades reais** — o app lista a qualidade máxima que o vídeo tem de
  verdade + todas as inferiores (nada de oferecer 4K em vídeo 240p)
- 🎵 **Áudio por bitrate** — MP3 com a melhor taxa da fonte
- 🔁 **Conversor embutido** — converta o download para MKV, WebM, MP3, M4A,
  OPUS ou WAV com o ffmpeg que já vem junto
- 📁 **Pasta própria** — downloads organizados em `Downloads/YTGrab`
- ⚙️ **Configurações** — idioma (PT/EN), tema escuro/claro e frequência de
  verificação de atualizações
- 🔄 **Atualização automática** — o app avisa quando existe versão nova
- 📦 **Zero dependências** — yt-dlp e ffmpeg já vêm embutidos

---

## 🧑‍💻 Créditos

| Build | Autor |
|---|---|
| 🐧 AppImage (Linux) | Feito por [**lucasgabrieldevgg**](https://github.com/lucasgabrieldevgg) |
| 🪟 Instalador (Windows) | Feito por [**Micael San**](https://github.com/MicaelSanPedro) |

---

## 🛠️ Desenvolvimento

```bash
npm ci          # dependências do frontend
npm run tauri dev
```

Builds de release: `.github/workflows/build.yml` gera o AppImage (Linux) e o
instalador NSIS (Windows) e publica na release da versão. Detalhes técnicos do
AppImage em [`docs/APPIMAGE.md`](docs/APPIMAGE.md).

<div align="center">

Feito com 💙 pela comunidade — [contribua](https://github.com/MicaelSanPedro/ytgrab/issues)!

</div>
