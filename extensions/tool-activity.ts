import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type ToolActivityProfile = {
	id: string;
	priority?: number;
	match: string | RegExp | ((toolName: string, args: unknown) => boolean);
	label?: string | ((toolName: string, args: unknown) => string);
	start?: string | ((toolName: string, args: unknown) => string);
	update?: string | ((toolName: string, args: unknown, partialResult: unknown) => string);
	success?: string | ((toolName: string, args: unknown, result: unknown) => string);
	error?: string | ((toolName: string, args: unknown, result: unknown) => string);
};

type ToolActivityEntry = {
	toolCallId: string;
	toolName: string;
	args: unknown;
	startedAt: number;
	updatedAt: number;
	phase: "running" | "done" | "error";
	message: string;
	profile?: ToolActivityProfile;
};

type ToolActivityRegisterPayload = ToolActivityProfile | ToolActivityProfile[];

type ToolExecutionInstance = ToolExecutionComponent & {
	toolName: string;
	toolCallId: string;
	ui?: { requestRender?: () => void };
	updateDisplay?: () => void;
	formatToolExecution?: () => string;
	createCallFallback?: () => Text;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TICK_MS = 120;
const DONE_VISIBLE_MS = 900;
const STATUS_ID = "tool-activity";
const PATCH_MARK = Symbol.for("pi.tool-activity-extension.tool-row-patched");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function invokeMessage(
	value: string | ((toolName: string, args: unknown, payload?: unknown) => string) | undefined,
	toolName: string,
	args: unknown,
	payload?: unknown,
): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "function") return value(toolName, args, payload);
	return undefined;
}

function profileMatches(profile: ToolActivityProfile, toolName: string, args: unknown): boolean {
	if (typeof profile.match === "string") return profile.match === toolName;
	if (profile.match instanceof RegExp) return profile.match.test(toolName);
	return profile.match(toolName, args);
}

function selectProfile(profiles: ToolActivityProfile[], toolName: string, args: unknown): ToolActivityProfile | undefined {
	return profiles
		.filter((profile) => profileMatches(profile, toolName, args))
		.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
}

function profileLabel(profile: ToolActivityProfile | undefined, toolName: string, args: unknown): string {
	if (!profile?.label) return toolName;
	if (typeof profile.label === "string") return profile.label;
	return profile.label(toolName, args);
}

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function extractTextContent(result: unknown): string {
	if (!isRecord(result)) return "";
	const content = result.content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
		.filter(Boolean)
		.join("\n");
}

function genericUpdateMessage(partialResult: unknown): string {
	if (isRecord(partialResult)) {
		const details = partialResult.details;
		if (isRecord(details)) {
			if (typeof details.phase === "string") return details.phase;
			if (typeof details.status === "string") return details.status;
			if (typeof details.progress === "number") return `Progress ${Math.round(details.progress)}%…`;
		}
	}

	const text = extractTextContent(partialResult);
	if (text) return `Receiving output (${text.split("\n").length} lines)…`;
	return "Running…";
}

function createDefaultProfiles(): ToolActivityProfile[] {
	return [
		{
			id: "context-mode",
			priority: 100,
			match: /^ctx_/,
			label: (toolName) => toolName.replace(/^ctx_/, "ctx "),
			start: (toolName) => {
				if (toolName === "ctx_batch_execute") return "Running commands and indexing output…";
				if (toolName === "ctx_execute") return "Running sandboxed process…";
				if (toolName === "ctx_execute_file") return "Processing file in sandbox…";
				if (toolName === "ctx_search") return "Searching indexed context…";
				if (toolName === "ctx_fetch_and_index") return "Fetching and indexing content…";
				return "Processing context…";
			},
			update: (_toolName, _args, partialResult) => genericUpdateMessage(partialResult),
			success: "Done",
			error: "Failed",
		},
		{
			id: "shell",
			priority: 50,
			match: /^(bash|shell)$/,
			label: (toolName) => (toolName === "bash" ? "shell" : toolName),
			start: "Running command…",
			update: (_toolName, _args, partialResult) => genericUpdateMessage(partialResult),
			success: "Command finished",
			error: "Command failed",
		},
		{
			id: "network",
			priority: 40,
			match: /^(web_search|fetch_content|get_search_content|code_search)$/,
			label: (toolName) => toolName.replace(/_/g, " "),
			start: "Waiting for network response…",
			update: "Processing response…",
			success: "Response ready",
			error: "Request failed",
		},
	];
}

export default function toolActivityExtension(pi: ExtensionAPI) {
	const profiles = createDefaultProfiles();
	const active = new Map<string, ToolActivityEntry>();
	const components = new Map<string, ToolExecutionInstance>();
	let lastCtx: any;
	let timer: ReturnType<typeof setInterval> | undefined;
	let frame = 0;

	function liveSuffix(toolCallId: string): string | undefined {
		const entry = active.get(toolCallId);
		if (!entry) return undefined;
		const icon = entry.phase === "done" ? "✓" : entry.phase === "error" ? "✗" : SPINNER[frame % SPINNER.length];
		const elapsed = formatElapsed(Date.now() - entry.startedAt);
		return `${icon} ${elapsed} ${truncate(entry.message, 56)}`;
	}

	function patchToolRows() {
		const proto = ToolExecutionComponent.prototype as unknown as ToolExecutionInstance & { [PATCH_MARK]?: boolean };
		if (proto[PATCH_MARK]) return;

		const originalUpdateDisplay = proto.updateDisplay;
		proto.updateDisplay = function patchedUpdateDisplay(this: ToolExecutionInstance) {
			if (this.toolCallId) components.set(this.toolCallId, this);
			return originalUpdateDisplay?.call(this);
		};

		const originalFormat = proto.formatToolExecution;
		proto.formatToolExecution = function patchedFormatToolExecution(this: ToolExecutionInstance) {
			const base = originalFormat?.call(this) ?? this.toolName;
			const suffix = liveSuffix(this.toolCallId);
			if (!suffix) return base;
			const lines = base.split("\n");
			lines[0] = `${lines[0]}  ${suffix}`;
			return lines.join("\n");
		};

		const originalCreateCallFallback = proto.createCallFallback;
		proto.createCallFallback = function patchedCreateCallFallback(this: ToolExecutionInstance) {
			const suffix = liveSuffix(this.toolCallId);
			if (!suffix) return originalCreateCallFallback?.call(this) ?? new Text(this.toolName, 0, 0);
			// This is the Claude-Code-like same-row path for tools without a custom renderCall,
			// including MCP/context-mode tools. Built-in renderers keep their own bespoke UI.
			return new Text(`${this.toolName}  ${suffix}`, 0, 0);
		};

		proto[PATCH_MARK] = true;
	}

	function registerProfiles(payload: ToolActivityRegisterPayload) {
		const incoming = Array.isArray(payload) ? payload : [payload];
		for (const profile of incoming) {
			const existingIndex = profiles.findIndex((candidate) => candidate.id === profile.id);
			if (existingIndex >= 0) profiles.splice(existingIndex, 1, profile);
			else profiles.push(profile);
		}
	}

	function clearUi(ctx = lastCtx) {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus(STATUS_ID, undefined);
		ctx.ui.setWorkingMessage();
	}

	function refreshToolRows() {
		for (const [toolCallId, component] of components) {
			if (!active.has(toolCallId)) {
				components.delete(toolCallId);
				continue;
			}
			component.updateDisplay?.();
			component.invalidate();
			component.ui?.requestRender?.();
		}
	}

	function render(ctx = lastCtx) {
		if (!ctx?.hasUI) return;

		const now = Date.now();
		for (const [toolCallId, entry] of active) {
			if (entry.phase !== "running" && now - entry.updatedAt > DONE_VISIBLE_MS) {
				active.delete(toolCallId);
			}
		}

		refreshToolRows();

		if (active.size === 0) {
			clearUi(ctx);
			stopTimer();
			return;
		}

		const entries = [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
		const running = entries.filter((entry) => entry.phase === "running");
		const primary = running[0] ?? entries[entries.length - 1];
		const icon = primary.phase === "done" ? "✓" : primary.phase === "error" ? "✗" : SPINNER[frame % SPINNER.length];
		frame++;

		const label = profileLabel(primary.profile, primary.toolName, primary.args);
		const suffix = entries.length > 1 ? ` +${entries.length - 1}` : "";
		ctx.ui.setStatus(
			STATUS_ID,
			truncate(`${icon} ${label}${suffix} ${formatElapsed(now - primary.startedAt)} · ${primary.message}`, 90),
		);
		ctx.ui.setWorkingMessage(truncate(`${primary.toolName}: ${primary.message}`, 90));
	}

	function ensureTimer() {
		if (timer) return;
		timer = setInterval(() => render(), TICK_MS);
		if (typeof timer.unref === "function") timer.unref();
	}

	function stopTimer() {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	}

	patchToolRows();
	pi.events.on("tool-activity:register-profile", registerProfiles);

	pi.on("tool_execution_start", async (event: any, ctx: any) => {
		lastCtx = ctx;
		const profile = selectProfile(profiles, event.toolName, event.args);
		const message = invokeMessage(profile?.start, event.toolName, event.args) ?? "Running…";
		active.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			startedAt: Date.now(),
			updatedAt: Date.now(),
			phase: "running",
			message,
			profile,
		});
		render(ctx);
		ensureTimer();
	});

	pi.on("tool_execution_update", async (event: any, ctx: any) => {
		lastCtx = ctx;
		const entry = active.get(event.toolCallId);
		if (!entry) return;
		entry.updatedAt = Date.now();
		entry.args = event.args ?? entry.args;
		entry.message =
			invokeMessage(entry.profile?.update, entry.toolName, entry.args, event.partialResult) ??
			genericUpdateMessage(event.partialResult);
		render(ctx);
	});

	pi.on("tool_execution_end", async (event: any, ctx: any) => {
		lastCtx = ctx;
		const entry = active.get(event.toolCallId);
		if (!entry) return;
		entry.updatedAt = Date.now();
		entry.phase = event.isError ? "error" : "done";
		entry.message =
			invokeMessage(event.isError ? entry.profile?.error : entry.profile?.success, entry.toolName, entry.args, event.result) ??
			(event.isError ? "Failed" : "Done");
		render(ctx);
		ensureTimer();
	});

	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		active.clear();
		components.clear();
		stopTimer();
		clearUi(ctx);
	});

	pi.registerCommand("tool-activity", {
		description: "Show tool activity extension status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Tool activity row UI is active with ${profiles.length} profile(s). Other extensions can emit "tool-activity:register-profile" to add or replace profiles.`,
				"info",
			);
		},
	});
}
