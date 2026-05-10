/**
 * Read-Only Mode Extension
 *
 * Toggle between read-only and normal mode.
 * In RO mode, only read-only tools are available (read, grep, find, ls).
 * Write tools (write, edit, bash) are blocked.
 *
 * Usage:
 *   /ro          – toggle read-only mode
 *   /ro on       – enter read-only mode
 *   /ro off      – exit read-only mode
 *   /ro status   – show current mode
 *   Alt+R          – toggle RO mode
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

const WRITE_TOOLS = new Set(["write", "edit", "bash"]);

let isReadOnly = false;
let pendingNotification: string | null = null;

export default function (pi: ExtensionAPI) {
    function setRO(ctx: { ui: any }) {
        if (isReadOnly) return;
        isReadOnly = true;
        ctx.ui.setStatus("ro", ctx.ui.theme.fg("warning", "[RO]"));
        ctx.ui.notify("Read-only mode ON", "warning");
        pendingNotification = "Read-only mode is now active. The following tools are blocked: write, edit, bash. Do not attempt to use them. You can only read and search. If the user asks for changes, explain what you would do and tell them to use /ro off to disable read-only mode.";
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

    // Belt-and-suspenders: block write tools at the event level too
    pi.on("tool_call", async (event, ctx) => {
        if (!isReadOnly) return undefined;
        if (WRITE_TOOLS.has(event.toolName)) {
            return {
                block: true,
                reason: `Tool "${event.toolName}" is blocked in read-only mode. Use /ro off to disable.`,
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
            } else if (arg === "status") {
                if (isReadOnly) {
                    ctx.ui.notify("Current mode: [RO]", "warning");
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
