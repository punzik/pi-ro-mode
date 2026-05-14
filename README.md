# ro-mode

A [Pi](https://github.com/badlogic/pi-mono) extension that adds a read-only mode toggle, letting you restrict the agent to read-only operations mid-session.

Useful when you want to discuss code, review changes, or explore the codebase without risking unintended modifications. Switch between read-only and normal mode freely within the same session.

## Installation

### As a Pi package

From a local checkout:

```bash
pi install /path/to/pi-ro-mode
```

For one-off testing without installing:

```bash
pi -e /path/to/pi-ro-mode
```

When published, it can also be installed from npm or git:

```bash
pi install npm:pi-ro-mode
pi install git:github.com/punzik/pi-ro-mode
```

### Manual extension install

Copy both files from `extensions/` into one of Pi's auto-discovered extension locations. The config file must sit next to the extension entry point.

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/ro-mode.ts` + `~/.pi/agent/extensions/ro-mode.config.json` | Global (all projects) |
| `~/.pi/agent/extensions/ro-mode/index.ts` + `~/.pi/agent/extensions/ro-mode/ro-mode.config.json` | Global (subdirectory) |
| `.pi/extensions/ro-mode.ts` + `.pi/extensions/ro-mode.config.json` | Project-local |
| `.pi/extensions/ro-mode/index.ts` + `.pi/extensions/ro-mode/ro-mode.config.json` | Project-local (subdirectory) |

## Configuration

Edit `extensions/ro-mode.config.json` to customize the packaged default policy:

- `readOnlyTools` — tools that are always allowed in read-only mode.
- `bash.allowPatterns` — regular expressions for bash commands that may run.
- `bash.denyPatterns` — regular expressions for bash commands that are always blocked. Deny patterns take priority over allow patterns.

After changing the config, reload Pi extensions with `/reload` or restart Pi. For installed npm/git packages, customize by forking the package or installing a local checkout.

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/ro` | Toggle read-only mode on/off |
| `/ro on` | Enable read-only mode |
| `/ro off` | Disable read-only mode, restore normal operation |
| `/ro status` | Show current mode |

### Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Alt+R` | Toggle read-only mode on/off |

## How It Works

When read-only mode is active, the extension uses three layers of protection:

### 1. Tool Call Interception

The `tool_call` event handler allows only explicitly whitelisted read-only tools:

- `read` — file reading
- `grep` — text search
- `find` — file discovery
- `ls` — directory listing
- `bash` — only commands that match the read-only allowlist and do not match the denylist

Bash filtering is intentionally conservative: deny patterns win over allow patterns, and shell control operators / redirection are blocked. Any attempt by the model to call any other tool, or to run a non-allowed bash command, is immediately rejected with a descriptive error message. This is the hard enforcement layer — even if the model tries to use a non-allowed tool, it will not execute.

### 2. Context Message

When the mode changes, a notification message is queued and injected into the conversation context alongside the next user message (via the `before_agent_start` event). This tells the model which tools are allowed and how to behave, without modifying the system prompt.

Key design decisions:

- **System prompt is never modified** — the model's system prompt stays identical in both modes, preserving the provider's KV cache across switches. No cache miss, no extra token cost.
- **Notification is deferred** — the message is only sent when the user sends their next prompt. Toggling the mode multiple times without chatting only keeps the latest notification; no spam in the conversation history.

### 3. Session Persistence

The mode state is persisted in the session via `pi.appendEntry()` with the custom type `ro-state`. When a session is resumed (via `/resume`, `-c`, or session restore), the extension automatically restores the read-only mode if it was active.

## What the Model Sees

In read-only mode, when the user sends their next message, the model receives an additional context message:

> Read-only mode is now active. Only the following tools are allowed: read, grep, find, ls, bash with read-only commands only. Bash commands must match the read-only allowlist and must not match the denylist. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.

When read-only mode is disabled:

> Read-only mode is now disabled. All tools are available again.

## Visual Indicators

- **Status line**: when read-only mode is active, `[RO]` appears in the footer status area.
- **Notifications**: mode changes trigger inline notifications (`Read-only mode ON` / `Normal mode ON`).

## Example Workflow

```
User: /ro
→ [RO] appears in status line
→ Notification: "Read-only mode ON"

User: Can you review the authentication module?
Assistant: [reads files, discusses findings, suggests changes but does not modify anything]
→ If the model tries to call any tool outside the whitelist, or a non-allowed bash command → blocked with error

User: Looks good, go ahead and make those changes.
Assistant: I'm currently in read-only mode. Please use /ro off to disable it.

User: /ro off
→ [RO] disappears from status line
→ Notification: "Normal mode ON"

User: Apply the changes you suggested.
Assistant: [makes the edits]

User: /ro
→ [RO] appears in status line
→ Notification: "Read-only mode ON"

User: Review the changes you just made.
Assistant: [reads files, discusses findings]
```

## Why KV Cache Matters (Especially for Local Models)

This extension is specifically optimized for use with local models. When a coding agent modifies the system prompt — for example, by changing the list of available tools — the provider must re-process the entire system prompt from scratch, invalidating the KV cache. For cloud-hosted models this is fast and cheap. For local models, it can be painfully slow.

Local inference (e.g., llama.cpp, ollama, vLLM) runs on consumer hardware where prompt processing (prefill) is the bottleneck:

- **CPU-only setups** — prompt processing is sequential and slow. Re-processing a large system prompt after a tool list change can take tens of seconds, eating into your iteration speed.
- **Heterogeneous GPU+CPU systems** — models that don't fully fit in VRAM offload layers to CPU. Prefill then becomes a mix of fast GPU work and slow CPU work, and a cache miss means waiting for the full pipeline again.
- **Context-heavy sessions** — long AGENTS.md files, many skills, large system prompts. The bigger the prompt, the more painful each cache miss.

This extension avoids all of that by never modifying the system prompt. The available tool list stays identical in both modes. Instead, mode changes are communicated via a context message injected alongside the next user message — a small append to the conversation that preserves the cached system prompt prefix.

The result: switching between read-only and normal mode is essentially free in terms of prompt processing, regardless of your hardware.

## Limitations

- The mode state is in-memory within the extension. Restarting Pi (new session, not resume) starts in normal mode.
- Custom tools registered by other extensions are blocked by default in read-only mode. If you need to allow additional read-only tools, add them to `readOnlyTools` in `ro-mode.config.json`.
- Bash filtering is based on regular expressions, not a full shell parser. It is deliberately strict and may block some safe commands. Tune `bash.allowPatterns` and `bash.denyPatterns` in `ro-mode.config.json` for your workflow.

## License

GPL-3.0-only
