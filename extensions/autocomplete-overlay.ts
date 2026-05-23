import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

type EditorWithAutocompleteInternals = Editor & {
  autocompleteState?: unknown;
  autocompleteList?: { render(width: number): string[]; invalidate?: () => void };
  autocompleteOverlayHandle?: { hide(): void };
  __piAutocompletePopupLineCount?: number;
  paddingX?: number;
};

type AutocompletePatchState = {
  version: number;
  originalRender: typeof Editor.prototype.render;
  originalClearAutocompleteUi?: (this: EditorWithAutocompleteInternals) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var __piAutocompleteOverlayPatch: AutocompletePatchState | undefined;
}

const PATCH_VERSION = 6;

function stripAnsi(line: string): string {
  return line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function forceVisibleSelectedLine(line: string): string {
  const plain = stripAnsi(line);
  if (!plain.trimStart().startsWith("→ ")) return line;

  // In the fixed powerline compositor the selected slash row can inherit a
  // surrounding style/reset combination that leaves the row occupying space but
  // visually blank. Render selected autocomplete rows with explicit reverse
  // video so the highlighted item is always visible.
  return `\x1b[7m${plain}\x1b[27m`;
}

function hideStaleOverlay(editor: EditorWithAutocompleteInternals): void {
  // Older versions of this extension used TUI overlays. Make sure a stale
  // overlay from /reload is removed before switching to the in-flow popup.
  editor.autocompleteOverlayHandle?.hide();
  editor.autocompleteOverlayHandle = undefined;
}

function installAutocompletePopupPatch(): void {
  const existing = globalThis.__piAutocompleteOverlayPatch;

  // /reload runs in the same process. Restore the original methods first so
  // this file can be edited and reloaded repeatedly without stacking patches.
  if (existing) {
    Editor.prototype.render = existing.originalRender;
    if (existing.originalClearAutocompleteUi) {
      (Editor.prototype as unknown as { clearAutocompleteUi: (this: EditorWithAutocompleteInternals) => void }).clearAutocompleteUi =
        existing.originalClearAutocompleteUi;
    }
  }

  const originalRender = Editor.prototype.render;
  const originalClearAutocompleteUi = (Editor.prototype as unknown as {
    clearAutocompleteUi?: (this: EditorWithAutocompleteInternals) => void;
  }).clearAutocompleteUi;

  globalThis.__piAutocompleteOverlayPatch = {
    version: PATCH_VERSION,
    originalRender,
    originalClearAutocompleteUi,
  };

  Editor.prototype.render = function patchedRender(this: EditorWithAutocompleteInternals, width: number): string[] {
    hideStaleOverlay(this);

    const hasAutocomplete = Boolean(this.autocompleteState && this.autocompleteList);
    if (!hasAutocomplete || !this.autocompleteList) {
      this.__piAutocompletePopupLineCount = 0;
      return originalRender.call(this, width);
    }

    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(Number(this.paddingX ?? 0), maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const autocompleteLines = this.autocompleteList.render(contentWidth).map(forceVisibleSelectedLine);

    const rendered = originalRender.call(this, width);
    if (autocompleteLines.length === 0) {
      this.__piAutocompletePopupLineCount = 0;
      return rendered;
    }

    // The stock Editor appends autocomplete below the input. Move those rows
    // above the input instead. In your layout the powerline sits above the user
    // input, so this places autocomplete directly below that powerline and above
    // the editor, preserving the same bottom-anchored scroll behavior.
    const editorLines = rendered.slice(0, Math.max(0, rendered.length - autocompleteLines.length));
    const leftPadding = " ".repeat(paddingX);
    const rightPadding = leftPadding;
    const popupLines = autocompleteLines.map((line) => `${leftPadding}${line}${rightPadding}`);
    // Keep one spacer row above the popup. Some terminal/powerline layouts draw
    // directly against the top autocomplete row, which can make the selected
    // first slash command occupy space but appear clipped/blank.
    const popupBlock = ["", ...popupLines];
    this.__piAutocompletePopupLineCount = popupBlock.length;

    return [...popupBlock, ...editorLines];
  };

  if (originalClearAutocompleteUi) {
    (Editor.prototype as unknown as { clearAutocompleteUi: (this: EditorWithAutocompleteInternals) => void }).clearAutocompleteUi =
      function patchedClearAutocompleteUi(this: EditorWithAutocompleteInternals): void {
        hideStaleOverlay(this);
        originalClearAutocompleteUi.call(this);
      };
  }
}

export default function (_pi: ExtensionAPI): void {
  installAutocompletePopupPatch();
}
