#!/usr/bin/env python3
"""Resolve the full dependency closure for Termux packages (aarch64).

Reads an apt "Packages" index file and prints, one per line, the `Filename`
(relative to the repository root, e.g. `pool/main/p/python/...deb`) of every
package needed to install the seed packages (Depends + Recommends closure).

Usage:
    termux_closure.py <path-to-Packages-index> <package> [package ...]

Exit codes:
    0 success
    1 seed package missing or package without Filename
    2 usage error
"""

import re
import sys


def parse_index(path):
    """Parse an apt Packages index into {name: [ {version, depends, recommends, filename} ]}.

    A new stanza starts at every "Package:" line (apt indexes also separate
    stanzas with blank lines, but this is more robust).
    """
    pkgs = {}
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()

    data = {}
    key = None
    for line in lines:
        if line == "":
            continue
        m = re.match(r"^([A-Za-z0-9-]+):\s*(.*)$", line)
        if m:
            key = m.group(1).lower()
            if key == "package" and data.get("name"):
                # a new stanza begins (in apt indexes "Package:" is the first
                # field of every stanza)
                _record(pkgs, data)
                data = {}
            if key == "package":
                data["name"] = m.group(2).strip()
            else:
                data[key] = m.group(2)
        elif key is not None and line[:1] in (" ", "\t"):
            # continuation of a multi-line field (e.g. Description)
            data[key] = data.get(key, "") + " " + line.strip()
    if data.get("name"):
        _record(pkgs, data)
    return pkgs


def _record(pkgs, data):
    pkgs.setdefault(data["name"], []).append(
        {
            "version": data.get("version", "0"),
            "depends": data.get("depends", ""),
            "recommends": data.get("recommends", ""),
            "filename": data.get("filename", ""),
        }
    )


def version_key(v):
    """A rough version sort key good enough for apt-style versions."""
    parts = []
    for chunk in re.split(r"[.\-+~:]", v):
        if chunk.isdigit():
            parts.append((1, int(chunk), ""))
        else:
            parts.append((0, 0, chunk))
    return parts


def dep_names(field, known):
    """Concrete package names required by a Depends/Recommends field value.

    Handles version constraints ("libz (>= 1.2)") and alternatives ("a | b").
    If an alternative group has no known member, the first name is kept (it
    may be a virtual package; the closure loop will report it as missing).
    """
    names = []
    if not field:
        return names
    for dep in field.split(","):
        dep = dep.strip()
        if not dep:
            continue
        alternatives = [a.strip() for a in dep.split("|") if a.strip()]
        chosen = None
        for alt in alternatives:
            name = re.split(r"\s|\(", alt)[0].strip()
            if name in known:
                chosen = name
                break
        if chosen is None and alternatives:
            chosen = re.split(r"\s|\(", alternatives[0])[0].strip()
        if chosen and chosen not in names:
            names.append(chosen)
    return names


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        sys.exit(2)

    index_path = sys.argv[1]
    seeds = sys.argv[2:]
    pkgs = parse_index(index_path)
    known = set(pkgs)

    closure = set()
    missing = set()
    queue = list(seeds)
    while queue:
        name = queue.pop()
        if name in closure:
            continue
        if name not in pkgs:
            missing.add(name)
            continue
        closure.add(name)
        best = max(pkgs[name], key=lambda p: version_key(p["version"]))
        for dep in dep_names(best["depends"], known):
            if dep not in closure and dep not in missing:
                queue.append(dep)
        for rec in dep_names(best["recommends"], known):
            if rec not in closure and rec not in missing:
                queue.append(rec)

    missing -= closure
    if missing:
        sys.stderr.write(
            "Aviso: dependencias nao encontradas no indice (ignoradas): %s\n"
            % ", ".join(sorted(missing))
        )

    for seed in seeds:
        if seed not in closure:
            sys.stderr.write("ERRO: pacote semente '%s' nao encontrado no indice\n" % seed)
            sys.exit(1)

    for name in sorted(closure):
        best = max(pkgs[name], key=lambda p: version_key(p["version"]))
        if not best["filename"]:
            sys.stderr.write("ERRO: pacote '%s' sem Filename no indice\n" % name)
            sys.exit(1)
        print(best["filename"])


if __name__ == "__main__":
    main()
