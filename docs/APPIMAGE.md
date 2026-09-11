# YTGrab para Linux (AppImage)

O YTGrab tem um AppImage oficial para Linux desktop. Ele é **autocontido**: já
traz o `yt-dlp` (binário standalone, com o Python embutido) e o `ffmpeg` (build
100% estático), então não é preciso instalar nada na distro — nem `python3`,
nem `ffmpeg`.

## Como usar

```bash
chmod +x YTGrab_<versão>_amd64.AppImage
./YTGrab_<versão>_amd64.AppImage
```

Se a sua distro não montar o AppImage, provavelmente falta o FUSE:

```bash
# Debian/Ubuntu
sudo apt install libfuse2
# Fedora
sudo dnf install fuse-libs
# ou, sem instalar nada:
./YTGrab_<versão>_amd64.AppImage --appimage-extract-and-run
```

## Como compilar

```bash
./scripts/build-appimage.sh
```

O resultado fica em `src-tauri/target/release/bundle/appimage/`.

No GitHub Actions o job `build-linux` (`.github/workflows/build.yml`) compila e
publica o AppImage no Release a cada push na `main`.

### Escolha do runner: por que `ubuntu-22.04`

Um AppImage **herda a glibc da máquina que o compilou**. Compilar em
`ubuntu-latest` geraria um arquivo que só abre em distros bem recentes. Usar o
runner mais antigo disponível (22.04, glibc 2.35) faz o AppImage funcionar em
Ubuntu 22.04+, Debian 12+, Fedora 36+ e equivalentes.

Se você compilar localmente, vale a mesma regra: o AppImage vai exigir a glibc
da sua distro. Para máxima compatibilidade, compile num container
`ubuntu:22.04`.

## Como as dependências são resolvidas

Um AppImage é uma imagem squashfs que se automonta: o binário roda de dentro de
`/tmp/.mount_XXXXXX/usr/bin`, que é **somente leitura**. Nada pode ser gravado
ao lado do executável — por isso a busca por `yt-dlp` e `ffmpeg` percorre, nesta
ordem (`find_ytdlp` / `find_ffmpeg` em `src-tauri/src/commands.rs`):

| # | Local | Escrita | Quem preenche |
|---|-------|---------|---------------|
| 1 | `<app_data_dir>/ytgrab-deps/bin` | gravável | `linux_setup.rs` (primeiro uso / botão reinstalar) |
| 2 | `<resource_dir>/deps` | somente leitura | embutido no AppImage via `tauri.linux.conf.json` |
| 3 | diretório do executável e `./bin` | varia | instalações manuais / `.deb` |
| 4 | `which` no `PATH` do sistema | — | a própria distro |

Na prática, o AppImage sempre acha as dependências no item 2 e nunca precisa
baixar nada. O item 1 existe para os casos em que elas faltam — uma instalação
via `.deb`, ou o usuário apagou os arquivos.

### `LD_LIBRARY_PATH`

O runtime do AppImage injeta o próprio `usr/lib` em `LD_LIBRARY_PATH` para o app
achar o webkit/GTK que ele embute. Essa variável é herdada pelos processos
filhos, e o `yt-dlp` standalone é um executável PyInstaller que carrega o
próprio `libz`/`libexpat`: pegar as cópias do AppImage no lugar das dele quebra
na inicialização. Por isso `clean_appimage_env()` remove `LD_LIBRARY_PATH` (e
`LD_PRELOAD`, `PERL5LIB`, `PYTHONHOME`, `PYTHONPATH`) antes de executar o
yt-dlp. O ffmpeg é estático e não é afetado.

## Arquivos desta parte do projeto

| Arquivo | Papel |
|---------|-------|
| `src-tauri/src/linux_setup.rs` | baixa/instala `yt-dlp` + `ffmpeg` no primeiro uso, com eventos `setup-progress` para o overlay do frontend |
| `src-tauri/tauri.linux.conf.json` | overlay de configuração só do Linux: embute `src-tauri/bin/*` em `deps/` e restringe o bundle a `appimage` |
| `scripts/build-appimage.sh` | build local (baixa as deps, instala pacotes de sistema, compila) |
| `.github/workflows/build.yml` | job `build-linux` |

### Por que um overlay em vez de mexer no `tauri.conf.json`

`tauri.conf.json` mantém `"resources": []`. O mapeamento de recursos fica só no
overlay, aplicado com `--config src-tauri/tauri.linux.conf.json`. Assim o
instalador do Windows continua exatamente como era: se o mapeamento estivesse no
config base, o NSIS passaria a embutir ~115 MB de binários sem ninguém pedir, e
o `tauri-action` do job de Windows não tem como receber esse overlay.

O `tauri-build` valida **todos** os `tauri*.conf.json` do diretório, mesmo sem o
`--config`. Ou seja: um campo inválido no overlay quebra o build de qualquer
plataforma. Foi assim que se descobriu que `bundle.linux.appimage` não aceita
`categories` nesta versão do Tauri (só `bundleMediaFramework` e `files`).

### O destino dos recursos não pode se chamar `ytgrab`

O mapeamento era `"bin/*": "ytgrab/"` e o build quebrava com:

```
error: failed to remove file `src-tauri/target/release/ytgrab`
Caused by: Is a directory (os error 21)
```

O motivo está no `tauri-build`: o build script deriva o diretório de destino a
partir do `OUT_DIR` (`out_dir.parent().parent().parent()`, com um
`// TODO: far from ideal` no código) e copia os `bundle.resources` para lá. Isso
resolve para `target/release`, então `"bin/*": "ytgrab/"` criava o **diretório**
`target/release/ytgrab/` — exatamente onde o cargo grava o binário `ytgrab`.
Como o build script roda antes do link, o cargo encontrava um diretório no lugar
do arquivo.

Daí o destino ser `deps/`. Se um dia o nome do binário mudar, o destino pode
voltar a ser qualquer coisa que não colida com ele.

## Testes

`cargo test --lib` roda os testes de sempre. O teste do extrator do ffmpeg segue
o padrão `FFMPEG_FIXTURE`: ele só roda quando a
variável aponta para um arquivo real, e aí extrai, confere o bit de execução e
**executa** o binário extraído.

```bash
curl -fL -o /tmp/ffmpeg.tar.xz \
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
FFMPEG_FIXTURE=/tmp/ffmpeg.tar.xz cargo test --lib
```

Sem a variável o teste é ignorado, então `cargo test --lib` continua rápido e
offline. O CI baixa o tarball de verdade em toda execução.

Esse teste existe por um motivo concreto: o crate `tar` **não** aplica o modo do
arquivo e o `File::create` obedece ao umask, então o `ffmpeg` saía da extração
como `0644` — sem o bit de execução, e inutilizável dentro do AppImage.
