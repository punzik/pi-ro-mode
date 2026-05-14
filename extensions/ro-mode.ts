/**
 * Read-Only Mode Extension
 *
 * Toggle between read-only and normal mode.
 * In RO mode, only tools listed in ro-mode.config.json are always allowed.
 * Bash is allowed only for commands that match the configured allowlist and do not match the denylist.
 * All other tools are blocked.
 *
 * Usage:
 *   /ro          – toggle read-only mode
 *   /ro on       – enter read-only mode
 *   /ro off      – exit read-only mode
 *   /ro status   – show current mode
 *   Alt+R          – toggle RO mode
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

type RoModeConfig = {
    readOnlyTools: string[];
    bash: {
        allowPatterns: string[];
        denyPatterns: string[];
    };
};

const extensionDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(extensionDir, "ro-mode.config.json");
const roConfig = JSON.parse(readFileSync(configPath, "utf8")) as RoModeConfig;

const READ_ONLY_TOOLS = new Set(roConfig.readOnlyTools);
const READ_ONLY_TOOLS_LIST = Array.from(READ_ONLY_TOOLS).join(", ");
const READ_ONLY_POLICY_DESCRIPTION = `${READ_ONLY_TOOLS_LIST}, bash with read-only commands only`;

const BASH_ALLOW_PATTERNS = roConfig.bash.allowPatterns.map((pattern) => new RegExp(pattern));
const BASH_DENY_PATTERNS = roConfig.bash.denyPatterns.map((pattern) => new RegExp(pattern));

function isReadOnlyBashCommand(command: string): boolean {
    const allowed = BASH_ALLOW_PATTERNS.some((pattern) => pattern.test(command));
    const denied = BASH_DENY_PATTERNS.some((pattern) => pattern.test(command));
    return allowed && !denied;
}

let isReadOnly = false;
let pendingNotification: string | null = null;

export default function (pi: ExtensionAPI) {
    function setRO(ctx: { ui: any }) {
        if (isReadOnly) return;
        isReadOnly = true;
        ctx.ui.setStatus("ro", ctx.ui.theme.fg("warning", "[RO]"));
        ctx.ui.notify("Read-only mode ON", "warning");
        pendingNotification = `Read-only mode is now active. Only the following tools are allowed: ${READ_ONLY_POLICY_DESCRIPTION}. Bash commands must match the read-only allowlist and must not match the denylist. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.`;
    }

    function setRW(ctx: { ui: any }) {
        if (!isReadOnly) return;
        isReadOnly = false;
        ctx.ui.setStatus("ro", undefined);
        ctx.ui.notify("Normal mode ON", "info");
        pendingNotification = "Read-only mode is now disabled. All tools are available again.";
    }

    // Inject pending mode notification alongside user message
    pi.on("before_agent_start", async () => {
        if (!pendingNotification) return;
        const content = pendingNotification;
        pendingNotification = null;
        return {
            message: {
                customType: "ro-mode",
                content,
                display: true,
            },
        };
    });

    // Belt-and-suspenders: allow only explicitly whitelisted read-only tools at the event level too
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

    // Command: /ro [on|off|status]
    pi.registerCommand("ro", {
        description: "Toggle read-only mode. Usage: /ro [on|off|status]",
        handler: async (args, ctx) => {
            const arg = args?.trim().toLowerCase();

            if (arg === "off" || arg === "no" || arg === "disable") {
                setRW(ctx);
            } else if (arg === "on" || arg === "yes" || arg === "enable") {
                setRO(ctx);
            } else if (arg === "status") {
                if (isReadOnly) {
                    ctx.ui.notify("Current mode: READ-ONLY", "warning");
                } else {
                    ctx.ui.notify("Current mode: NORMAL", "info");
                }
            } else {
                // No argument → toggle mode
                if (isReadOnly) {
                    setRW(ctx);
                } else {
                    setRO(ctx);
                }
            }
        },
    });

    // Keyboard shortcut: Alt+R to toggle
    pi.registerShortcut("alt+r", {
        description: "Toggle read-only mode",
        handler: async (ctx) => {
            if (isReadOnly) {
                setRW(ctx);
            } else {
                setRO(ctx);
            }
        },
    });

    // Restore state from session
    pi.on("session_start", async (_event, ctx) => {
        const entries = ctx.sessionManager.getEntries();
        const last = entries
            .filter((e: any) => e.type === "custom" && e.customType === "ro-state")
            .pop() as any;

        if (last?.data?.active) {
            isReadOnly = false; // reset so setRO actually runs
            setRO(ctx);
        }
    });

    // Persist state
    pi.on("turn_start", async () => {
        pi.appendEntry("ro-state", { active: isReadOnly });
    });
}
