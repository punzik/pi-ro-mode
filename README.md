# pi-ro-mode

A [Pi](https://pi.dev) package that adds a toggleable read-only mode for coding sessions.

## Why

Use read-only mode when you want to review, inspect, or discuss a codebase without allowing the agent to modify files or run write-capable commands.

The extension does not change the system prompt when the mode changes. It injects a small context message on the next turn instead, which helps preserve provider KV cache for local models.

## Behavior

When read-only mode is active:

- the footer shows `[RO]`;
- only configured read-only tools are allowed;
- `bash` is allowed only for commands that match the configured allowlist and do not match the denylist;
- blocked tool calls fail with a message that explains how to disable read-only mode.

By default, the allowed tools are `read`, `grep`, `find`, and `ls`. Bash commands are restricted to read-only inspection commands such as `pwd`, `ls`, `rg`, `cat`, `find`, and selected read-only `git` commands.

## Recommended Pi tool setup

Pi enables only `read`, `write`, `edit`, and `bash` by default. Since read-only mode works best with Pi's dedicated read-only inspection tools, it is recommended to also activate `grep`, `find`, and `ls`.

For one session, pass the full tool list on the command line:

```bash
pi --tools read,bash,edit,write,grep,find,ls
```

To make this the default for this extension, set `appendToolsOnStart` in `ro-mode.config.json`:

```json
{
  "appendToolsOnStart": ["grep", "find", "ls"]
}
```

The packaged default is an empty list, so installing the extension does not change Pi's default active tools unless you opt in. `appendToolsOnStart` preserves existing active tools and may only add Pi's dedicated read-only inspection tools: `grep`, `find`, and `ls`.

You can also use an environment variable plus a shell wrapper in `~/.bashrc`, `~/.zshrc`, or similar:

```bash
export PI_DEFAULT_TOOLS=read,bash,edit,write,grep,find,ls
pi() {
  case "$1" in
    install|remove|uninstall|update|list|config) command pi "$@" ;;
    *) command pi --tools "${PI_DEFAULT_TOOLS}" "$@" ;;
  esac
}
```

`PI_RO_MODE=1` can still be used separately to start new sessions with read-only mode already enabled.

## Installation

### From git

```bash
pi install git:github.com/punzik/pi-ro-mode
```

### From a local checkout

```bash
pi install /path/to/pi-ro-mode
```

### Project-local install

```bash
pi install -l /path/to/pi-ro-mode
```

### Try without installing

```bash
pi -e /path/to/pi-ro-mode
```

If Pi is already running, reload packages and extensions with:

```text
/reload
```

## Configuration

Configuration is optional. The extension reads and merges config in this order:

| Priority | Path | Scope |
|----------|------|-------|
| 1 | `extensions/ro-mode.config.json` | Packaged defaults |
| 2 | `~/.pi/agent/ro-mode.config.json` | Global |
| 3 | `<project>/.pi/ro-mode.config.json` | Project-local |

Project-local settings override global settings. Global settings override packaged defaults. If no config file is present, built-in defaults are used.

| Field | Type | Description |
|-------|------|-------------|
| `readOnlyTools` | `string[]` | Tool names allowed in read-only mode. |
| `appendToolsOnStart` | `string[]` | Read-only inspection tool names to append to Pi's active tools at session start. Only `grep`, `find`, and `ls` are accepted. Defaults to `[]`. |
| `bash.allowPatterns` | `string[]` | Regular expressions for bash commands that may run. |
| `bash.denyPatterns` | `string[]` | Regular expressions for bash commands that are always blocked. Deny patterns win. |

Example:

```json
{
  "readOnlyTools": ["read", "grep", "find", "ls"],
  "appendToolsOnStart": ["grep", "find", "ls"],
  "bash": {
    "allowPatterns": ["^\\s*pwd\\s*$", "^\\s*git\\s+status\\b[\\s\\S]*$"],
    "denyPatterns": ["[;&|`]", "(?:^|[^\\\\])(?:>>?|<<?)"]
  }
}
```

After changing config, reload Pi extensions with `/reload` or restart Pi.

## Usage

```text
/ro          # toggle read-only mode
/ro on       # enable read-only mode
/ro off      # disable read-only mode
/ro status   # show current mode
```

Keyboard shortcut:

```text
Alt+R        # toggle read-only mode
```

To start new sessions in read-only mode, set `PI_RO_MODE` to `1`, `true`, `yes`, or `on`:

```bash
PI_RO_MODE=1 pi
```

The mode is also persisted in resumed sessions.

## How it works

The extension listens for tool calls and blocks disallowed tools while read-only mode is active. It keeps the normal Pi tool list unchanged, except for optional startup appends from `appendToolsOnStart`, and enforces policy at execution time.

Mode changes are queued as a context message for the next user prompt:

- read-only enabled: tells the model which tools are allowed and asks it to explain proposed changes instead of applying them;
- read-only disabled: tells the model all tools are available again.

Session state is persisted with a custom `ro-state` session entry.

## Limitations

- Without `PI_RO_MODE`, a new session starts in normal mode.
- Custom tools from other extensions are blocked by default unless listed in `readOnlyTools`.
- Bash filtering uses regular expressions, not a full shell parser. It is intentionally conservative and may block safe commands.

## Package layout

```text
.
├── extensions/
│   ├── ro-mode.ts
│   └── ro-mode.config.json
├── LICENSE
├── package.json
└── README.md
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
