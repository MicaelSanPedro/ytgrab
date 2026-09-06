#!/usr/bin/env python3
"""CI guard: verify the REAL Termux aarch64 debs still contain what the app
expects at first-run.

The app installs the `python` and `ffmpeg` packages (plus their dependency
closure) into its own data directory and then checks that
`termux/usr/bin/python3*` and `termux/usr/bin/ffmpeg` exist. If Termux ever
renames, splits or transitions those packages, first-run on a real device
breaks. This script downloads the two current debs from the live index and
fails the build — with a clear, actionable message — before that happens.

Stdlib only; runs on GitHub's ubuntu-latest (has network, unlike dev sandboxes).
"""
import gzip
import io
import sys
import tarfile
import urllib.request

INDEX_URL = (
    "https://packages.termux.dev/apt/termux-main/dists/stable/main/binary-aarch64/Packages.gz"
)
BASE_URL = "https://packages.termux.dev/apt/termux-main"


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


def parse_index(data: bytes):
    text = gzip.decompress(data).decode("utf-8", "replace")
    pkgs = {}
    name = None
    for line in text.splitlines():
        if not line or line[0] in " \t" or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if key == "Package":
            name = value
            pkgs[name] = {}
        elif name is not None:
            pkgs[name][key] = value
    return pkgs


def ar_data_tar(deb: bytes):
    """Return (member_name, data_bytes) of the data.tar member of an ar image.
    Mirrors the Rust implementation in android_setup.rs (including the GNU ar
    trailing-slash quirk: member names are space-padded and end with '/')."""
    if deb[:8] != b"!<arch>\n":
        raise SystemExit("FAIL: arquivo não é um ar image (magic ausente)")
    off = 8
    while off + 60 <= len(deb):
        raw = deb[off : off + 16].decode("ascii", "replace")
        name = raw.strip().rstrip("/").strip()
        size = int(deb[off + 48 : off + 58].strip() or "0")
        off += 60
        if name == "data.tar" or name.startswith("data.tar."):
            return name, deb[off : off + size]
        off += size + (size % 2)
    raise SystemExit("FAIL: membro data.tar não encontrado no .deb")


def data_tar_members(payload_name: str, payload: bytes):
    if payload_name.endswith(".gz"):
        payload = gzip.decompress(payload)
    elif payload_name.endswith(".xz"):
        import lzma

        payload = lzma.decompress(payload)
    elif payload_name != "data.tar":
        raise SystemExit(f"FAIL: data.tar em formato não tratado: {payload_name}")
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as tf:
        members = {}
        for m in tf.getmembers():
            n = m.name
            while n.startswith("./"):
                n = n[2:]
            members[n] = m
        return members


def check_python(members):
    found = [
        n
        for n in members
        if n == "usr/bin/python3" or (n.startswith("usr/bin/python3.") and members[n].isfile())
    ]
    if not found:
        bins = sorted(n for n in members if n.startswith("usr/bin/"))[:60]
        raise SystemExit(
            "FAIL: o .deb do pacote 'python' NÃO contém mais usr/bin/python3*.\n"
            f"    Bins encontrados: {', '.join(bins)}\n"
            "    -> o app procura usr/bin/python3 (ou python3.X) em termux/usr/bin; "
            "atualize android_setup.rs e este guard."
        )
    print(f"OK python: interpretador em {', '.join(sorted(found))}")


def check_ffmpeg(members):
    m = members.get("usr/bin/ffmpeg")
    if m is None or not m.isfile():
        bins = sorted(n for n in members if n.startswith("usr/bin/"))[:60]
        raise SystemExit(
            "FAIL: o .deb do pacote 'ffmpeg' NÃO contém mais usr/bin/ffmpeg (arquivo).\n"
            f"    Bins encontrados: {', '.join(bins)}\n"
            "    -> o app procura usr/bin/ffmpeg em termux/usr/bin; "
            "atualize android_setup.rs e este guard."
        )
    print("OK ffmpeg: usr/bin/ffmpeg presente (binário real)")


def main():
    pkgs = parse_index(fetch(INDEX_URL))
    for pname, check in (("python", check_python), ("ffmpeg", check_ffmpeg)):
        info = pkgs.get(pname)
        if not info:
            raise SystemExit(
                f"FAIL: o pacote '{pname}' SUMIU do índice aarch64 do Termux. "
                "O seed do app (android_setup.rs) precisa de outro nome."
            )
        filename = info.get("Filename")
        if not filename:
            raise SystemExit(f"FAIL: pacote '{pname}' sem Filename no índice")
        url = f"{BASE_URL}/{filename}"
        print(f"==> {pname} ({info.get('Version')}): baixando {url} ...")
        deb = fetch(url)
        member, payload = ar_data_tar(deb)
        members = data_tar_members(member, payload)
        check(members)
        print(f"    ({len(members)} arquivos no {member})")
    print("termux_deb_check: os debs reais contêm o que o app espera ✔")


if __name__ == "__main__":
    main()
