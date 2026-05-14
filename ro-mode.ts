/**
 * Read-Only Mode Extension
 *
 * Toggle between read-only and normal mode.
 * In RO mode, only explicitly allowed read-only tools are available (read, grep, find, ls).
 * All other tools are blocked.
 *
 * Usage:
 *   /ro          – toggle read-only mode
 *   /ro on       – enter read-only mode
 *   /ro off      – exit read-only mode
 *   /ro status   – show current mode
 *   Alt+R          – toggle RO mode
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const READ_ONLY_TOOLS_LIST = Array.from(READ_ONLY_TOOLS).join(", ");

let isReadOnly = false;
let pendingNotification: string | null = null;

export default function (pi: ExtensionAPI) {
    function setRO(ctx: { ui: any }) {
        if (isReadOnly) return;
        isReadOnly = true;
        ctx.ui.setStatus("ro", ctx.ui.theme.fg("warning", "[RO]"));
        ctx.ui.notify("Read-only mode ON", "warning");
        pendingNotification = `Read-only mode is now active. Only the following tools are allowed: ${READ_ONLY_TOOLS_LIST}. Do not attempt to use any other tools. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.`;
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
        if (!READ_ONLY_TOOLS.has(event.toolName)) {
            return {
                block: true,
                reason: `Tool "${event.toolName}" is not allowed in read-only mode. Allowed tools: ${READ_ONLY_TOOLS_LIST}. Use /ro off to disable.`,
            };
        }
        return undefined;
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
