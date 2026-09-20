import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { decodeConfig } from "#core/config/decode.ts";
import { defaultConfig, type PermissionConfig } from "#core/config/schema.ts";
import { agentDir, CONFIG_DIR } from "#identity";
import { describe, isRecord } from "#util/primitives.ts";

export interface LoadedConfig {
	config: PermissionConfig;
	path: string;
	warnings: string[];
}

export function configPath(): string {
	return join(agentDir(), "extensions", CONFIG_DIR, "config.json");
}

export function grantsPath(): string {
	return join(agentDir(), "extensions", CONFIG_DIR, "grants.json");
}

export function projectGrantsPath(cwd: string, configDirName: string): string {
	return join(cwd, configDirName, "extensions", CONFIG_DIR, "grants.json");
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
