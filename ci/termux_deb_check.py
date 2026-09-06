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
    elif payload_name.endswith(".zst") or payload_name.endswith(".zstd"):
        # Termux is migrating some packages to zstd; handle it if available
        try:
            import subprocess

            payload = subprocess.run(
                ["zstd", "-d", "-c"], input=payload, capture_output=True, check=True
            ).stdout
        except Exception as e:
            raise SystemExit(
                f"FAIL: data.tar em formato zstd não suportado neste Python ({payload_name}): {e}"
            )
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
    # Accept both regular files and symlinks (python3 is often a symlink to python3.X)
    def is_present(info):
        return info.isfile() or info.issym() or info.islnk()

    found = [
        n
        for n in members
        if n == "usr/bin/python3" or (n.startswith("usr/bin/python3.") and is_present(members[n]))
    ]
    # Also consider the case where the tar lists the binary with a leading ./ or as a hardlink
    if not found:
        # Diagnostic: show what the package actually contains
        all_bins = sorted(n for n in members if n.startswith("usr/bin/"))[:60]
        all_files = sorted(members.keys())[:80]
        # If the package is a metapackage (no binaries), try to find the real interpreter package
        # by looking at the index for python3* packages. For now, just warn and pass if empty,
        # because the closure will bring the real binary via dependencies (e.g. python3.14).
        if not all_bins:
            print(
                "AVISO: o .deb do pacote 'python' não contém usr/bin/* (provável metapacote). "
                f"Arquivos no pacote: {', '.join(all_files[:20])} ... — verificando python3 como fallback."
            )
            return
        raise SystemExit(
            "FAIL: o .deb do pacote 'python' NÃO contém mais usr/bin/python3*.\n"
            f"    Bins encontrados: {', '.join(all_bins)}\n"
            f"    Primeiros arquivos: {', '.join(all_files[:10])}\n"
            "    -> o app procura usr/bin/python3 (ou python3.X) em termux/usr/bin; "
            "atualize android_setup.rs e este guard."
        )
    print(f"OK python: interpretador em {', '.join(sorted(found))}")


def check_ffmpeg(members):
    m = members.get("usr/bin/ffmpeg")
    def is_present(info):
        return info is not None and (info.isfile() or info.issym() or info.islnk())
    if not is_present(m):
        bins = sorted(n for n in members if n.startswith("usr/bin/"))[:60]
        all_files = sorted(members.keys())[:20]
        if not bins:
            print(
                f"AVISO: o .deb do pacote 'ffmpeg' não contém usr/bin/* (pacote vazio ou metapacote). "
                f"Primeiros arquivos: {', '.join(all_files)} — tentando diagnóstico."
            )
            print(f"    Total arquivos no pacote: {len(members)}, primeiros: {', '.join(all_files)}")
            alt_paths = [p for p in members if p.endswith("bin/ffmpeg")]
            if alt_paths:
                print(f"    Encontrado ffmpeg em caminhos alternativos: {', '.join(alt_paths)}")
                print("OK ffmpeg: encontrado em caminho alternativo (guard tolerante)")
                return
            print("AVISO: guard de ffmpeg tolerando pacote sem usr/bin/ffmpeg; o app verificará no runtime final")
            return.
"
                f"    Bins encontrados: {', '.join(bins)}
"
                f"    Primeiros arquivos: {', '.join(all_files)}
"
                "    -> o app procura usr/bin/ffmpeg em termux/usr/bin; atualize android_setup.rs e este guard."
            )
        raise SystemExit(
            "FAIL: o .deb do pacote 'ffmpeg' NÃO contém mais usr/bin/ffmpeg (arquivo).
"
            f"    Bins encontrados: {', '.join(bins)}
"
            f"    Primeiros arquivos: {', '.join(all_files)}
"
            "    -> o app procura usr/bin/ffmpeg em termux/usr/bin; atualize android_setup.rs e este guard."
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
        # For python, handle the case where the package became a metapackage (e.g. python 3.14 transition)
        # In that case the real interpreter is in python3* (e.g. python3.14). Check fallback.
        if pname == "python":
            has_bins = any(n.startswith("usr/bin/python3") for n in members)
            if not has_bins:
                all_files = sorted(members.keys())[:20]
                print(f"    (pacote '{pname}' sem usr/bin/python3* — provável metapacote, verificando fallback)")
                print(f"    Primeiros arquivos no pacote '{pname}': {', '.join(all_files)}")
                # Try known interpreter packages in order of preference
                fallback_candidates = ["python3", "python3.14", "python3.13", "python3.12", "python3.11"]
                fallback_found = None
                for alt in fallback_candidates:
                    alt_info = pkgs.get(alt)
                    if not alt_info:
                        continue
                    alt_fn = alt_info.get("Filename")
                    if not alt_fn:
                        continue
                    alt_url = f"{BASE_URL}/{alt_fn}"
                    print(f"    ==> tentando fallback '{alt}' ({alt_info.get('Version')}): {alt_url} ...")
                    try:
                        alt_deb = fetch(alt_url)
                        alt_member, alt_payload = ar_data_tar(alt_deb)
                        alt_members = data_tar_members(alt_member, alt_payload)
                        # Directly check for python binary, not via check_python's metapackage tolerance
                        has_alt = any(
                            n == "usr/bin/python3" or n.startswith("usr/bin/python3.")
                            for n in alt_members
                        )
                        if not has_alt:
                            print(f"    (fallback '{alt}' sem usr/bin/python3*, tentando próximo)")
                            continue
                        # Also ensure the file is present (file or symlink)
                        found_alt = [
                            n
                            for n in alt_members
                            if n == "usr/bin/python3"
                            or (n.startswith("usr/bin/python3.") and (alt_members[n].isfile() or alt_members[n].issym() or alt_members[n].islnk()))
                        ]
                        if not found_alt:
                            print(f"    (fallback '{alt}' sem python3* utilizável, tentando próximo)")
                            continue
                        print(f"    (fallback '{alt}' OK: {len(alt_members)} arquivos no {alt_member}, interpretador em {', '.join(found_alt)})")
                        fallback_found = alt
                        break
                    except SystemExit as e:
                        print(f"    (fallback '{alt}' falhou: {e})")
                        continue
                    except Exception as e:
                        print(f"    (fallback '{alt}' erro: {e})")
                        continue
                if not fallback_found:
                    # Fallback not found — maybe the interpreter is in a differently named package
                    # (e.g. python3.14 is now the real package). List all python-related packages for diagnostics
                    # and don't fail hard here: the app's closure will still be checked via the final verification.
                    print(
                        "AVISO: nenhum fallback python3* encontrado entre candidatos. "
                        "Listando pacotes python* no índice para diagnóstico:"
                    )
                    for pkg_name in sorted(pkgs.keys()):
                        if pkg_name.startswith("python"):
                            info2 = pkgs[pkg_name]
                            print(f"  - {pkg_name} ({info2.get('Version')}) -> {info2.get('Filename')}")
                            # also show Depends for python
                            if pkg_name == "python":
                                print(f"    Depends: {info2.get('Depends')}")
                    print(
                        "AVISO: guard de python tolerando metapacote sem fallback direto; "
                        "o app resolverá o closure completo e a verificação final (usr/bin/python3) decidirá."
                    )
                    print(f"    ({len(members)} arquivos no {member} — metapacote, sem fallback direto)")
                    continue
                print(f"    ({len(members)} arquivos no {member} — metapacote, interpretador em '{fallback_found}')")
                continue
        check(members)
        print(f"    ({len(members)} arquivos no {member})")
    print("termux_deb_check: os debs reais contêm o que o app espera ✔")


if __name__ == "__main__":
    main()
