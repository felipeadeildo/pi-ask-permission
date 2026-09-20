import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The extension's identity in one place. Renaming the project means editing
 * these two constants and the package name, nothing else.
 */
export const NAME = "pi-ask-permission";
export const CONFIG_DIR = "pi-ask-permission";

export function agentDir(): string {
	const fromEnv = process.env.PI_CODING_AGENT_DIR;
	return fromEnv ? expandTilde(fromEnv) : join(homedir(), ".pi", "agent");
}

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}
