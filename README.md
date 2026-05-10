# ro-mode

A [Pi](https://github.com/badlogic/pi-mono) extension that adds a read-only mode toggle, letting you restrict the agent to read-only operations mid-session.

Useful when you want to discuss code, review changes, or explore the codebase without risking unintended modifications. Switch between read-only and normal mode freely within the same session.

## Installation

Place `ro-mode.ts` in one of the auto-discovered extension directories:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/ro-mode.ts` | Global (all projects) |
| `~/.pi/agent/extensions/ro-mode/index.ts` | Global (subdirectory) |
| `.pi/extensions/ro-mode.ts` | Project-local |
| `.pi/extensions/ro-mode/index.ts` | Project-local (subdirectory) |

Alternatively, load it directly with the CLI:

```bash
pi -e /path/to/ro-mode.ts
```

Or install as a [Pi package](https://github.com/badlogic/pi-mono#pi-packages).

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/ro` | Enable read-only mode |
| `/ro on` | Enable read-only mode (explicit) |
| `/ro off` | Disable read-only mode, restore normal operation |
| `/ro status` | Show current mode |

### Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Alt+R` | Toggle read-only mode on/off |

## How It Works

When read-only mode is active, the extension uses three layers of protection:

### 1. Tool Call Interception

The `tool_call` event handler blocks the following tools:

- `write` — file creation / overwrite
- `edit` — file editing
- `bash` — shell command execution

Any attempt by the model to call these tools is immediately rejected with a descriptive error message. This is the hard enforcement layer — even if the model tries to use a blocked tool, it will not execute.

### 2. Context Message

When the mode changes, a notification message is queued and injected into the conversation context alongside the next user message (via the `before_agent_start` event). This tells the model which tools are blocked and how to behave, without modifying the system prompt.

Key design decisions:

- **System prompt is never modified** — the model's system prompt stays identical in both modes, preserving the provider's KV cache across switches. No cache miss, no extra token cost.
- **Notification is deferred** — the message is only sent when the user sends their next prompt. Toggling the mode multiple times without chatting only keeps the latest notification; no spam in the conversation history.

### 3. Session Persistence

The mode state is persisted in the session via `pi.appendEntry()` with the custom type `ro-state`. When a session is resumed (via `/resume`, `-c`, or session restore), the extension automatically restores the read-only mode if it was active.

## What the Model Sees

In read-only mode, when the user sends their next message, the model receives an additional context message:

> Read-only mode is now active. The following tools are blocked: write, edit, bash. Do not attempt to use them. You can only read and search. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.

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
→ If the model tries to call write/edit/bash → blocked with error

User: Looks good, go ahead and make those changes.
Assistant: I'm currently in read-only mode. Please use /ro off to disable it.

User: /ro off
→ [RO] disappears from status line
→ Notification: "Normal mode ON"

User: Apply the changes you suggested.
Assistant: [makes the edits]
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
- Custom tools registered by other extensions are not blocked. Only the built-in `write`, `edit`, and `bash` tools are restricted. If you need to block additional tools, edit the `WRITE_TOOLS` set in `ro-mode.ts`.

## TODO

- [ ] **Smart bash command filter** — instead of blocking `bash` entirely in read-only mode, allow read-only commands through while blocking writes. For example, `git diff`, `git log`, `git status`, `ls`, `cat`, `grep`, and similar read-only commands should be permitted, while `git commit`, `git push`, `rm`, `cp`, `mv`, `npm install`, and other mutating commands should be blocked. This would make read-only mode more practical for code review workflows where the agent needs to run inspect commands.

## License

MIT
