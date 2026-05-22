#!/usr/bin/env bash
set -euo pipefail

# Installs JetBrainsMono Nerd Font for the terminal icon glyphs used by the
# pi-powerline-footer overlay. The font itself is downloaded from the official
# Nerd Fonts release artifact instead of committing binary fonts to this repo.

FONT_NAME="JetBrainsMono"
FONT_URL="${PI_CONFIG_NERD_FONT_URL:-https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip}"
LINUX_FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts/pi-config/JetBrainsMonoNerdFont"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

command -v curl >/dev/null 2>&1 || { echo "curl is required to install Nerd Font" >&2; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required to install Nerd Font" >&2; exit 1; }

ZIP_PATH="$TMP_DIR/$FONT_NAME.zip"
EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR" "$LINUX_FONT_DIR"

echo "Downloading $FONT_NAME Nerd Font..."
curl -fsSL "$FONT_URL" -o "$ZIP_PATH"

unzip -q -o "$ZIP_PATH" -d "$EXTRACT_DIR"
find "$EXTRACT_DIR" -type f \( -name '*.ttf' -o -name '*.otf' \) -exec cp -f {} "$LINUX_FONT_DIR" \;

if command -v fc-cache >/dev/null 2>&1; then
  fc-cache -f "$LINUX_FONT_DIR" >/dev/null 2>&1 || true
fi

echo "Installed Linux fonts to: $LINUX_FONT_DIR"

# If running under WSL, also install into the Windows per-user Fonts directory,
# because Windows Terminal renders glyphs using Windows fonts, not WSL fonts.
if command -v powershell.exe >/dev/null 2>&1 && [ -d /mnt/c/Users ]; then
  WIN_USER="${PI_CONFIG_WINDOWS_USER:-$(cmd.exe /C echo %USERNAME% 2>/dev/null | tr -d '\r' || true)}"
  WIN_FONT_DIR="/mnt/c/Users/$WIN_USER/AppData/Local/Microsoft/Windows/Fonts"

  if [ -n "$WIN_USER" ] && [ -d "/mnt/c/Users/$WIN_USER" ]; then
    mkdir -p "$WIN_FONT_DIR"
    find "$LINUX_FONT_DIR" -maxdepth 1 -type f \( -name '*.ttf' -o -name '*.otf' \) -exec cp -f {} "$WIN_FONT_DIR" \;

    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '
      $fontDir = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts"
      $regPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts"
      Get-ChildItem -Path $fontDir -Filter "JetBrainsMonoNerdFont*.ttf" | ForEach-Object {
        $name = ($_.BaseName + " (TrueType)")
        New-ItemProperty -Path $regPath -Name $name -Value $_.FullName -PropertyType String -Force | Out-Null
      }
      Get-ChildItem -Path $fontDir -Filter "JetBrainsMonoNerdFont*.otf" | ForEach-Object {
        $name = ($_.BaseName + " (OpenType)")
        New-ItemProperty -Path $regPath -Name $name -Value $_.FullName -PropertyType String -Force | Out-Null
      }

      $terminalSettings = Join-Path $env:LOCALAPPDATA "Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json"
      if (Test-Path $terminalSettings) {
        $json = Get-Content -Raw $terminalSettings | ConvertFrom-Json
        if (-not $json.profiles) { $json | Add-Member -NotePropertyName profiles -NotePropertyValue ([pscustomobject]@{}) }
        if (-not $json.profiles.defaults) { $json.profiles | Add-Member -NotePropertyName defaults -NotePropertyValue ([pscustomobject]@{}) }
        if (-not $json.profiles.defaults.font) { $json.profiles.defaults | Add-Member -NotePropertyName font -NotePropertyValue ([pscustomobject]@{}) }
        $json.profiles.defaults.font.face = "JetBrainsMono NFM"
        $json | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $terminalSettings
      }
    ' >/dev/null 2>&1 || true

    echo "Installed Windows user fonts to: $WIN_FONT_DIR"
    echo "Set Windows Terminal font face to: JetBrainsMono NFM"
  else
    echo "Skipped Windows font install: could not determine Windows user" >&2
  fi
fi
