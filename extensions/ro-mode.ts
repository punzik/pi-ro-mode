/**
 * pi-ro-mode — toggleable read-only mode for Pi sessions.
 *
 * Blocks write-capable tools while read-only mode is active and allows bash only
 * for commands that match the configured read-only policy.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAgentDir,
  isToolCallEventType,
  type CustomEntry,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

type RoModeConfig = {
  readOnlyTools: string[];
  bash: {
    allowPatterns: string[];
    denyPatterns: string[];
  };
};

type PartialRoModeConfig = {
  readOnlyTools?: string[];
  bash?: {
    allowPatterns?: string[];
    denyPatterns?: string[];
  };
};

type RoState = {
  active: boolean;
};

type SetModeOptions = {
  notify?: boolean;
  queueContextMessage?: boolean;
};

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGED_DEFAULT_CONFIG_PATH = join(EXTENSION_DIR, "ro-mode.config.json");
const GLOBAL_CONFIG_PATH = join(getAgentDir(), "ro-mode.config.json");
const PROJECT_CONFIG_PATH = resolve(process.cwd(), ".pi", "ro-mode.config.json");

const RO_MODE_ENV_VAR = "PI_RO_MODE";
const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const COMMAND_ARGUMENTS = ["on", "off", "status"];
const RO_STATE_CUSTOM_TYPE = "ro-state";

const BUILTIN_DEFAULT_CONFIG: RoModeConfig = {
  readOnlyTools: ["read", "grep", "find", "ls"],
  bash: {
    allowPatterns: [
      "^\\s*pwd\\s*$",
      "^\\s*(?:ls|grep|rg|cat|head|tail|wc|du|tree|file|stat)\\b[\\s\\S]*$",
      "^\\s*find\\b[\\s\\S]*$",
      "^\\s*git(?:\\s+(?:-C\\s+\\S+|--no-pager|-c\\s+\\S+))*\\s+(?:status|diff|log|show|ls-files|grep|rev-parse|describe|blame)\\b[\\s\\S]*$",
      "^\\s*git(?:\\s+(?:-C\\s+\\S+|--no-pager|-c\\s+\\S+))*\\s+branch(?:\\s+(?:--show-current|--all|--remotes|--contains|--merged|--no-merged|--list|-a|-r|-v|-vv))*\\s*$",
      "^\\s*git(?:\\s+(?:-C\\s+\\S+|--no-pager|-c\\s+\\S+))*\\s+remote(?:\\s+(?:-v|--verbose|show(?:\\s+\\S+)?))?\\s*$",
    ],
    denyPatterns: [
      "(?:^|[^\\\\])(?:>>?|<<?)",
      "[;&|`]",
      "\\$\\s*\\(",
      "\\b(?:rm|mv|cp|touch|mkdir|rmdir|truncate|dd|install|chmod|chown|ln|unlink|tee|xargs|rsync|scp|ssh|curl|wget|make|ninja|cmake)\\b",
      "\\b(?:sh|bash|zsh|fish|python|python3|node|ruby|perl)\\b",
      "\\b(?:sed|awk)\\b[\\s\\S]*\\b(?:-i|system\\s*\\()",
      "\\bfind\\b[\\s\\S]*\\s-(?:delete|exec|execdir|ok|okdir)\\b",
      "\\bgit\\b[\\s\\S]*\\b(?:add|commit|push|pull|reset|checkout|switch|merge|rebase|tag|stash|clean|apply|restore|rm|mv)\\b",
      "\\bgit\\b[\\s\\S]*\\s--(?:output|ext-diff)\\b",
      "\\b(?:npm|pnpm|yarn|bun)\\s+(?:install|add|remove|update|upgrade|ci|run|exec|dlx|create|init)\\b",
      "\\b(?:cargo|go|pip|pipx|uv|poetry|gem|bundle)\\s+(?:install|add|remove|update|upgrade|run|build|test|publish)\\b",
    ],
  },
};

const RO_CONFIG = loadConfig();
const READ_ONLY_TOOLS = new Set(RO_CONFIG.readOnlyTools);
const READ_ONLY_TOOLS_LIST = RO_CONFIG.readOnlyTools.join(", ");
const READ_ONLY_POLICY_DESCRIPTION = `${READ_ONLY_TOOLS_LIST}, bash with read-only commands only`;
const BASH_ALLOW_PATTERNS = compilePatterns(RO_CONFIG.bash.allowPatterns, "bash.allowPatterns");
const BASH_DENY_PATTERNS = compilePatterns(RO_CONFIG.bash.denyPatterns, "bash.denyPatterns");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readConfigFile(configPath: string): PartialRoModeConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return validateConfig(raw, configPath);
  } catch (error) {
    console.error(`pi-ro-mode: failed to read config ${configPath}: ${formatError(error)}`);
    return {};
  }
}

function validateConfig(raw: unknown, configPath: string): PartialRoModeConfig {
  if (!isRecord(raw)) {
    console.error(`pi-ro-mode: ignoring invalid config ${configPath}: expected an object`);
    return {};
  }

  const config: PartialRoModeConfig = {};

  if (hasOwn(raw, "readOnlyTools")) {
    if (isStringArray(raw.readOnlyTools)) {
      config.readOnlyTools = raw.readOnlyTools;
    } else {
      console.error(`pi-ro-mode: ignoring invalid readOnlyTools in ${configPath}: expected string[]`);
    }
  }

  if (hasOwn(raw, "bash")) {
    if (isRecord(raw.bash)) {
      const bashConfig: PartialRoModeConfig["bash"] = {};

      if (hasOwn(raw.bash, "allowPatterns")) {
        if (isStringArray(raw.bash.allowPatterns)) {
          bashConfig.allowPatterns = raw.bash.allowPatterns;
        } else {
          console.error(`pi-ro-mode: ignoring invalid bash.allowPatterns in ${configPath}: expected string[]`);
        }
      }

      if (hasOwn(raw.bash, "denyPatterns")) {
        if (isStringArray(raw.bash.denyPatterns)) {
          bashConfig.denyPatterns = raw.bash.denyPatterns;
        } else {
          console.error(`pi-ro-mode: ignoring invalid bash.denyPatterns in ${configPath}: expected string[]`);
        }
      }

      config.bash = bashConfig;
    } else {
      console.error(`pi-ro-mode: ignoring invalid bash config in ${configPath}: expected an object`);
    }
  }

  return config;
}

function mergeConfig(base: RoModeConfig, override: PartialRoModeConfig): RoModeConfig {
  return {
    readOnlyTools: override.readOnlyTools ?? base.readOnlyTools,
    bash: {
      allowPatterns: override.bash?.allowPatterns ?? base.bash.allowPatterns,
      denyPatterns: override.bash?.denyPatterns ?? base.bash.denyPatterns,
    },
  };
}

function cloneConfig(config: RoModeConfig): RoModeConfig {
  return {
    readOnlyTools: [...config.readOnlyTools],
    bash: {
      allowPatterns: [...config.bash.allowPatterns],
      denyPatterns: [...config.bash.denyPatterns],
    },
  };
}

function loadConfig(): RoModeConfig {
  const configPaths = [PACKAGED_DEFAULT_CONFIG_PATH, GLOBAL_CONFIG_PATH, PROJECT_CONFIG_PATH];
  let config = cloneConfig(BUILTIN_DEFAULT_CONFIG);

  for (const candidatePath of configPaths) {
    if (!existsSync(candidatePath)) continue;
    config = mergeConfig(config, readConfigFile(candidatePath));
  }

  return config;
}

function compilePatterns(patterns: string[], label: string): RegExp[] {
  const compiled: RegExp[] = [];

  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern));
    } catch (error) {
      console.error(`pi-ro-mode: ignoring invalid ${label} regex ${JSON.stringify(pattern)}: ${formatError(error)}`);
    }
  }

  return compiled;
}

function isRoModeEnabledByEnv(): boolean {
  const value = process.env[RO_MODE_ENV_VAR];
  if (!value) return false;
  return TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

function isReadOnlyBashCommand(command: string): boolean {
  const allowed = BASH_ALLOW_PATTERNS.some((pattern) => pattern.test(command));
  const denied = BASH_DENY_PATTERNS.some((pattern) => pattern.test(command));
  return allowed && !denied;
}

function isRoStateEntry(entry: SessionEntry): entry is CustomEntry<RoState> {
  return (
    entry.type === "custom" &&
    entry.customType === RO_STATE_CUSTOM_TYPE &&
    isRecord(entry.data) &&
    typeof entry.data.active === "boolean"
  );
}

function getLastRoState(entries: SessionEntry[]): RoState | undefined {
  const stateEntry = entries.filter(isRoStateEntry).pop();
  return stateEntry?.data;
}

function getArgumentCompletions(prefix: string) {
  const trimmedPrefix = prefix.trim();
  const items = COMMAND_ARGUMENTS.filter((value) => value.startsWith(trimmedPrefix)).map((value) => ({ value, label: value }));
  return items.length > 0 ? items : null;
}

export default function (pi: ExtensionAPI) {
  let isReadOnly = false;
  let pendingNotification: string | undefined;

  function updateStatus(ctx: ExtensionContext): void {
    if (isReadOnly) {
      ctx.ui.setStatus("ro", ctx.ui.theme.fg("warning", "[RO]"));
    } else {
      ctx.ui.setStatus("ro", undefined);
    }
  }

  function notifyStatus(ctx: ExtensionContext): void {
    if (isReadOnly) {
      ctx.ui.notify("Read-only mode ON", "warning");
    } else {
      ctx.ui.notify("Normal mode ON", "info");
    }
  }

  function queueModeNotification(): void {
    if (isReadOnly) {
      pendingNotification = `Read-only mode is now active. Only the following tools are allowed: ${READ_ONLY_POLICY_DESCRIPTION}. Bash commands must match the read-only allowlist and must not match the denylist. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.`;
    } else {
      pendingNotification = "Read-only mode is now disabled. All tools are available again.";
    }
  }

  function setReadOnlyMode(ctx: ExtensionContext, active: boolean, options: SetModeOptions = {}): void {
    const notify = options.notify ?? true;
    const queueContextMessage = options.queueContextMessage ?? true;
    const changed = isReadOnly !== active;

    isReadOnly = active;
    updateStatus(ctx);

    if (changed && queueContextMessage) {
      queueModeNotification();
    }

    if (notify) {
      notifyStatus(ctx);
    }
  }

  // Session lifecycle.
  pi.on("session_start", async (_event, ctx) => {
    const state = getLastRoState(ctx.sessionManager.getEntries());
    const startReadOnly = isRoModeEnabledByEnv() || state?.active === true;
    setReadOnlyMode(ctx, startReadOnly, { notify: startReadOnly, queueContextMessage: startReadOnly });
  });

  pi.on("turn_start", async () => {
    pi.appendEntry<RoState>(RO_STATE_CUSTOM_TYPE, { active: isReadOnly });
  });

  // Commands and shortcuts.
  pi.registerCommand("ro", {
    description: "Toggle read-only mode. Usage: /ro [on|off|status]",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "") {
        setReadOnlyMode(ctx, !isReadOnly);
        return;
      }

      if (arg === "on") {
        setReadOnlyMode(ctx, true);
        return;
      }

      if (arg === "off") {
        setReadOnlyMode(ctx, false);
        return;
      }

      if (arg === "status") {
        notifyStatus(ctx);
        return;
      }

      ctx.ui.notify("Usage: /ro [on|off|status]", "error");
    },
  });

  pi.registerShortcut("alt+r", {
    description: "Toggle read-only mode",
    handler: async (ctx) => {
      setReadOnlyMode(ctx, !isReadOnly);
    },
  });

  // Core behavior.
  pi.on("before_agent_start", async () => {
    if (!pendingNotification) return undefined;

    const content = pendingNotification;
    pendingNotification = undefined;

    return {
      message: {
        customType: "ro-mode",
        content,
        display: true,
      },
    };
  });

  pi.on("tool_call", async (event) => {
    if (!isReadOnly) return undefined;

    if (READ_ONLY_TOOLS.has(event.toolName)) return undefined;

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      if (isReadOnlyBashCommand(command)) return undefined;

      return {
        block: true,
        reason: `Bash command is not allowed in read-only mode: ${command}. Allowed bash commands must match the read-only allowlist and must not match the denylist. Use /ro off to disable.`,
      };
    }

    return {
      block: true,
      reason: `Tool "${event.toolName}" is not allowed in read-only mode. Allowed tools: ${READ_ONLY_POLICY_DESCRIPTION}. Use /ro off to disable.`,
    };
  });
}
