import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Codex OAuth email display is integrated into pi-powerline-footer's welcome
// component at ~/.pi/agent/npm/node_modules/pi-powerline-footer/welcome.ts.
// Keep this extension as a harmless marker so older settings/reloads do not
// fail if this file is still auto-discovered.
export default function (_pi: ExtensionAPI) {}
