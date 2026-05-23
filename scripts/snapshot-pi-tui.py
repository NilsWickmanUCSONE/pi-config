#!/usr/bin/env python3
"""Capture a deterministic-ish pi TUI snapshot in a pseudo terminal.

Usage:
  scripts/snapshot-pi-tui.py slash-autocomplete

Writes:
  artifacts/tui/<scenario>.ansi
  artifacts/tui/<scenario>.txt
  artifacts/tui/<scenario>.report.txt
"""
from __future__ import annotations

import argparse
import fcntl
import os
import re
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

CSI_RE = re.compile(r"\x1b\[([0-9;?]*)([@-~])")
OSC_RE = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")
ANSI_RE = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[=>78cDEHM]|")


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


class Screen:
    def __init__(self, rows: int, cols: int) -> None:
        self.rows = rows
        self.cols = cols
        self.grid = [[" " for _ in range(cols)] for _ in range(rows)]
        self.r = 0
        self.c = 0
        self.saved = (0, 0)

    def clear(self) -> None:
        self.grid = [[" " for _ in range(self.cols)] for _ in range(self.rows)]
        self.r = 0
        self.c = 0

    def clear_line(self) -> None:
        if 0 <= self.r < self.rows:
            self.grid[self.r] = [" " for _ in range(self.cols)]

    def move(self, row1: int, col1: int) -> None:
        self.r = max(0, min(self.rows - 1, row1 - 1))
        self.c = max(0, min(self.cols - 1, col1 - 1))

    def put(self, ch: str) -> None:
        if ch == "\n":
            self.r = min(self.rows - 1, self.r + 1)
            return
        if ch == "\r":
            self.c = 0
            return
        if ch == "\b":
            self.c = max(0, self.c - 1)
            return
        if ch == "\t":
            for _ in range(4):
                self.put(" ")
            return
        if ord(ch) < 32:
            return
        if 0 <= self.r < self.rows and 0 <= self.c < self.cols:
            self.grid[self.r][self.c] = ch
        self.c += 1
        if self.c >= self.cols:
            self.c = 0
            self.r = min(self.rows - 1, self.r + 1)

    def text(self) -> str:
        return "\n".join("".join(row).rstrip() for row in self.grid).rstrip() + "\n"


def parse_params(params: str) -> list[int]:
    params = params.replace("?", "")
    if not params:
        return []
    out = []
    for part in params.split(";"):
        if part == "":
            out.append(0)
        else:
            try:
                out.append(int(part))
            except ValueError:
                out.append(0)
    return out


def render_ansi_to_screen(data: str, rows: int, cols: int) -> str:
    s = Screen(rows, cols)
    i = 0
    while i < len(data):
        ch = data[i]
        if ch == "\x1b":
            # OSC
            if data.startswith("\x1b]", i):
                bel = data.find("\x07", i + 2)
                st = data.find("\x1b\\", i + 2)
                ends = [x for x in [bel + 1 if bel != -1 else -1, st + 2 if st != -1 else -1] if x != -1]
                i = min(ends) if ends else i + 2
                continue
            m = CSI_RE.match(data, i)
            if m:
                params = parse_params(m.group(1))
                cmd = m.group(2)
                n = params[0] if params else 0
                if cmd in ("H", "f"):
                    s.move(params[0] if len(params) > 0 and params[0] else 1, params[1] if len(params) > 1 and params[1] else 1)
                elif cmd == "J":
                    if n in (0, 2, 3):
                        s.clear()
                elif cmd == "K":
                    s.clear_line()
                elif cmd == "A":
                    s.r = max(0, s.r - (n or 1))
                elif cmd == "B":
                    s.r = min(s.rows - 1, s.r + (n or 1))
                elif cmd == "C":
                    s.c = min(s.cols - 1, s.c + (n or 1))
                elif cmd == "D":
                    s.c = max(0, s.c - (n or 1))
                elif cmd == "s":
                    s.saved = (s.r, s.c)
                elif cmd == "u":
                    s.r, s.c = s.saved
                # colors/modes ignored
                i = m.end()
                continue
            # Single escape or unknown, skip 2 bytes if possible.
            i += 2
            continue
        s.put(ch)
        i += 1
    return s.text()


def capture(scenario: str, rows: int, cols: int, out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    master, slave = os.openpty()
    set_winsize(slave, rows, cols)
    set_winsize(master, rows, cols)

    env = os.environ.copy()
    env.update({
        "PI_OFFLINE": "1",
        "POWERLINE_NERD_FONTS": "1",
        "TERM": env.get("TERM", "xterm-256color"),
        "COLORTERM": env.get("COLORTERM", "truecolor"),
        "NO_COLOR": "",
    })

    cmd = ["pi", "--offline"]
    proc = subprocess.Popen(
        cmd,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=str(Path.home()),
        env=env,
        preexec_fn=os.setsid,
        close_fds=True,
    )
    os.close(slave)
    os.set_blocking(master, False)

    chunks: list[bytes] = []
    start = time.monotonic()
    sent_slash = False
    sent_exit = False
    last_data = start

    try:
        while time.monotonic() - start < 8.0:
            readable, _, _ = select.select([master], [], [], 0.05)
            if readable:
                try:
                    data = os.read(master, 65536)
                except BlockingIOError:
                    data = b""
                except OSError:
                    break
                if not data:
                    break
                chunks.append(data)
                last_data = time.monotonic()

            elapsed = time.monotonic() - start
            if scenario == "slash-autocomplete" and not sent_slash and elapsed > 2.2:
                os.write(master, b"/")
                sent_slash = True
            if sent_slash and not sent_exit and elapsed > 4.8:
                os.write(master, b"\x03")
                sent_exit = True
            if sent_exit and proc.poll() is not None:
                break
            if sent_exit and time.monotonic() - last_data > 1.0:
                break
    finally:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        os.close(master)

    raw = b"".join(chunks)
    ansi_path = out_dir / f"{scenario}.ansi"
    txt_path = out_dir / f"{scenario}.txt"
    report_path = out_dir / f"{scenario}.report.txt"
    ansi_path.write_bytes(raw)
    text = render_ansi_to_screen(raw.decode("utf-8", "replace"), rows, cols)
    txt_path.write_text(text, encoding="utf-8")

    lines = text.splitlines()
    slash_rows = [i + 1 for i, line in enumerate(lines) if "/" in line and ("clear" in line or "model" in line or "reload" in line or "help" in line)]
    selected_rows = [i + 1 for i, line in enumerate(lines) if "→" in line]
    powerline_rows = [i + 1 for i, line in enumerate(lines) if any(g in line for g in ["π", "", "", "", "󱜙", "󰧑"])]
    report = [
        f"scenario={scenario}",
        f"cmd={shlex.join(cmd)}",
        f"size={cols}x{rows}",
        f"bytes={len(raw)}",
        f"slashRows={slash_rows}",
        f"selectedRows={selected_rows}",
        f"powerlineRows={powerline_rows}",
        f"ansi={ansi_path}",
        f"text={txt_path}",
        "--- screen ---",
        text,
    ]
    report_path.write_text("\n".join(report), encoding="utf-8")
    print(f"wrote {ansi_path}")
    print(f"wrote {txt_path}")
    print(f"wrote {report_path}")
    print("\n".join(report[:8]))
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["slash-autocomplete"])
    p.add_argument("--rows", type=int, default=30)
    p.add_argument("--cols", type=int, default=100)
    p.add_argument("--out-dir", type=Path, default=Path("artifacts/tui"))
    args = p.parse_args()
    return capture(args.scenario, args.rows, args.cols, args.out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
