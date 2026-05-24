---
name: uat-browser-testing
description: Use when the user explicitly asks to verify a web flow, perform UAT, reproduce a browser issue, check a local/dev/staging UI, or validate a frontend change in a real browser. Guides use of the Playwright MCP browser tools through Pi's mcp proxy.
---

# UAT Browser Testing

Use this skill to verify user-facing web flows in an isolated Playwright browser when the user has asked for browser/UAT verification.

Do **not** use this skill just because code changed. Use it when the task includes intent such as:

- "verify this flow"
- "test it in the browser"
- "do UAT"
- "reproduce the bug"
- "check the UI on localhost/staging"
- "make sure login/import/export/save works"
- "capture screenshots/network errors"

## Safety and scope

- Prefer local/dev/staging URLs over production.
- Do not use real personal accounts or production admin credentials unless the user explicitly authorizes it.
- Do not perform destructive actions, irreversible submissions, payments, mass emails, or production data changes without explicit confirmation immediately before the action.
- If a form has a final submit/confirm button and the user's instruction is ambiguous, stop before clicking and ask.
- Capture evidence for failures: screenshot, console messages, network requests, and concise reproduction steps.
- Logs and technical notes are in English. User-facing app text may be Swedish in this project.

## Tool discovery

Browser automation is provided through Pi's MCP proxy, not as direct tools. Discover tools on demand:

```js
mcp({})
mcp({ server: "playwright" })
mcp({ search: "navigate" })
mcp({ describe: "playwright_browser_navigate" })
```

Call tools with `args` as a JSON string:

```js
mcp({
  tool: "playwright_browser_navigate",
  args: "{\"url\":\"http://localhost:5173\"}"
})
```

Common tools:

- `playwright_browser_navigate` — open a URL.
- `playwright_browser_snapshot` — inspect the accessibility tree and element refs.
- `playwright_browser_click` — click an element from the snapshot.
- `playwright_browser_type` — type into a focused/editable element.
- `playwright_browser_fill_form` — fill several fields.
- `playwright_browser_press_key` — press Enter, Escape, Tab, etc.
- `playwright_browser_wait_for` — wait for text/state.
- `playwright_browser_take_screenshot` — save visual evidence.
- `playwright_browser_console_messages` — inspect console errors.
- `playwright_browser_network_requests` — list network activity.
- `playwright_browser_network_request` — inspect a specific failed request/response.
- `playwright_browser_tabs` — manage tabs.
- `playwright_browser_close` — close the browser page when done.

## UAT workflow

1. Clarify target and success criteria if missing:
   - URL/environment
   - credentials/test account requirements
   - exact flow steps
   - expected outcome
   - whether final submit/destructive action is allowed

2. Ensure the app is running if testing local dev:
   - Use project commands or ask the user to start services.
   - For large command output, use context-mode tools rather than raw bash output.

3. Open the page:
   - Navigate to the target URL.
   - Take an initial snapshot.
   - If the page fails to load, inspect console and network immediately.

4. Drive the flow step by step:
   - Use `snapshot` before interactions to identify stable element refs/names.
   - Use clicks/fills/keys through Playwright MCP.
   - Wait for expected UI changes after each major step.
   - Prefer accessible names/roles from snapshots over coordinates.

5. Verify outcomes:
   - Confirm visible success/error messages.
   - Check resulting page state, table rows, downloaded/generated text, or navigation.
   - Inspect network requests for failed API calls if the UI indicates a problem.
   - Capture screenshot(s) when useful or when a failure occurs.

6. Report concisely:
   - Environment/URL tested.
   - Flow steps executed.
   - Result: pass/fail/blocked.
   - Evidence: screenshots, relevant console/network errors.
   - Any follow-up code/test changes needed.

## Failure handling

When a flow fails:

- Do not blindly retry more than once unless there is a clear timing reason.
- Capture:
  - screenshot
  - console messages
  - network request list
  - details for failed request(s)
- State the exact step that failed and the observed vs expected behavior.
- If the failure appears to be test data/auth/environment related, say so and ask for missing setup rather than guessing.

## Project defaults for Mantalet

- Frontend dev server is usually Vite on `http://localhost:5173` from `frontend/Ask`.
- Frontend e2e tests live under the Ask frontend and can be run with `yarn test:e2e`.
- Prefer adding or updating Playwright e2e tests for repeatable UAT when a flow should be guarded long-term.
- Browser MCP is for exploratory verification and evidence collection; automated tests are preferred for regression coverage.
