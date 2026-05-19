import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

const ASSISTANT_PATCH_MARK = Symbol.for("pi.markdown-renderer-extension.assistant-patched");
const MARKDOWN_PATCH_MARK = Symbol.for("pi.markdown-renderer-extension.markdown-patched");

type AssistantContentPart =
	| { type: "text"; text: string; [key: string]: unknown }
	| { type: "thinking"; thinking: string; [key: string]: unknown }
	| { type: string; [key: string]: unknown };

type AssistantLikeMessage = {
	content?: AssistantContentPart[];
	[key: string]: unknown;
};

function countTrailingBackslashes(value: string, index: number): number {
	let count = 0;
	for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) count++;
	return count;
}

function hasUnbalancedInlineBacktick(text: string): boolean {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "`") continue;
		if (countTrailingBackslashes(text, i) % 2 === 1) continue;

		const runStart = i;
		while (i + 1 < text.length && text[i + 1] === "`") i++;
		const runLength = i - runStart + 1;
		if (runLength === 1) count++;
	}
	return count % 2 === 1;
}

function balanceCodeFences(markdown: string): string {
	const lines = markdown.split("\n");
	let openFence: { char: "`" | "~"; length: number } | undefined;

	for (const line of lines) {
		const match = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
		if (!match) continue;

		const fence = match[2];
		const char = fence[0] as "`" | "~";
		const length = fence.length;

		if (!openFence) {
			openFence = { char, length };
			continue;
		}

		if (openFence.char === char && length >= openFence.length) {
			openFence = undefined;
		}
	}

	if (!openFence) return markdown;
	return `${markdown}${markdown.endsWith("\n") ? "" : "\n"}${openFence.char.repeat(openFence.length)}`;
}

function normalizeMarkdownForDisplay(markdown: string): string {
	let normalized = markdown.replace(/\r\n?/g, "\n");
	normalized = balanceCodeFences(normalized);

	// During streaming, models often emit an opening inline ` before the closing one.
	// Add a display-only closer so the terminal markdown renderer does not leak code
	// styling into the rest of the message. This does not change saved conversation text.
	if (hasUnbalancedInlineBacktick(normalized)) normalized += "`";

	return normalized;
}

function stripAnsi(value: string): string {
	return value
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isFenceBorderLine(line: string): boolean {
	const visible = stripAnsi(line).trim();
	return /^```[\w.+#-]*$/.test(visible) || /^~~~[\w.+#-]*$/.test(visible);
}

function cloneMessageForDisplay(message: AssistantLikeMessage): AssistantLikeMessage {
	if (!Array.isArray(message.content)) return message;

	let changed = false;
	const content = message.content.map((part) => {
		if (part.type === "text" && typeof part.text === "string") {
			const text = normalizeMarkdownForDisplay(part.text);
			if (text !== part.text) changed = true;
			return text === part.text ? part : { ...part, text };
		}

		if (part.type === "thinking" && typeof part.thinking === "string") {
			const thinking = normalizeMarkdownForDisplay(part.thinking);
			if (thinking !== part.thinking) changed = true;
			return thinking === part.thinking ? part : { ...part, thinking };
		}

		return part;
	});

	return changed ? { ...message, content } : message;
}

export default function markdownRendererExtension(pi: ExtensionAPI) {
	const markdownProto = Markdown.prototype as unknown as {
		[MARKDOWN_PATCH_MARK]?: boolean;
		render(width: number): string[];
	};

	if (!markdownProto[MARKDOWN_PATCH_MARK]) {
		const originalMarkdownRender = markdownProto.render;
		markdownProto.render = function patchedMarkdownRender(width: number) {
			return originalMarkdownRender.call(this, width).filter((line) => !isFenceBorderLine(line));
		};
		markdownProto[MARKDOWN_PATCH_MARK] = true;
	}

	const assistantProto = AssistantMessageComponent.prototype as unknown as {
		[ASSISTANT_PATCH_MARK]?: boolean;
		updateContent(message: AssistantLikeMessage): void;
	};

	if (!assistantProto[ASSISTANT_PATCH_MARK]) {
		const originalUpdateContent = assistantProto.updateContent;
		assistantProto.updateContent = function patchedUpdateContent(message: AssistantLikeMessage) {
			return originalUpdateContent.call(this, cloneMessageForDisplay(message));
		};
		assistantProto[ASSISTANT_PATCH_MARK] = true;
	}

	pi.registerCommand("markdown-renderer", {
		description: "Show markdown renderer extension status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Markdown renderer is active: assistant markdown is rendered in chat; code fence markers are hidden and unclosed fences/backticks are balanced for display.",
				"info",
			);
		},
	});
}
