import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { ALWAYS_YES_FILE } from "#core/always-yes.ts";
import { decodeConfig, isOutdated } from "#core/config/decode.ts";
import { defaultConfig, type PermissionConfig } from "#core/config/schema.ts";
import { CONFIG_DIR } from "#identity";
import { describe, isRecord } from "#util/primitives.ts";

export interface LoadedConfig {
	config: PermissionConfig;
	path: string;
	warnings: string[];
	/** The file used names from before 3.0 and was rewritten. */
	updated?: boolean;
}

export function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_DIR, "config.json");
}

export function globalAlwaysYesPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_DIR, ALWAYS_YES_FILE);
}

export function projectAlwaysYesPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "extensions", CONFIG_DIR, ALWAYS_YES_FILE);
}

export function loadConfig(): LoadedConfig {
	const path = configPath();

	if (!existsSync(path)) {
		const config = defaultConfig();
		const warnings: string[] = [];
		try {
			writeConfigFile(path, config);
		} catch (error) {
			warnings.push(`could not create ${path}: ${describe(error)}`);
		}
		return { config, path, warnings };
	}

	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(raw)) {
			return {
				config: defaultConfig(),
				path,
				warnings: [`${path} must contain a JSON object; using defaults`],
			};
		}

		const warnings: string[] = [];
		const config = decodeConfig(raw, warnings);
		if (isOutdated(raw)) {
			writeConfigFile(path, config);
			return { config, path, warnings, updated: true };
		}
		return { config, path, warnings };
	} catch (error) {
		return {
			config: defaultConfig(),
			path,
			warnings: [`could not parse ${path}: ${describe(error)}; using defaults`],
		};
	}
}

export function saveConfig(config: PermissionConfig): string | undefined {
	try {
		writeConfigFile(configPath(), config);
		return undefined;
	} catch (error) {
		return describe(error);
	}
}

function writeConfigFile(path: string, config: PermissionConfig): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
