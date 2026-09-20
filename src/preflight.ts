import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import {
	createEditToolDefinition,
	type EditToolInput,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { describe } from "./util.ts";

/**
 * The edit tool with a no-op write. `execute` then runs the real access, read,
 * match, and duplicate/overlap checks and throws the same error the real edit
 * would, without touching the file.
 */
const dryRun = createEditToolDefinition(process.cwd(), {
	operations: {
		access: (path) => access(path, constants.R_OK | constants.W_OK),
		readFile: (path) => readFile(path),
		writeFile: async () => {},
	},
});

/** The matcher's message when an edit cannot apply, or undefined when it can. */
export async function editFailure(
	ctx: ExtensionContext,
	input: EditToolInput,
): Promise<string | undefined> {
	try {
		await dryRun.execute("preflight", input, ctx.signal, undefined, ctx);
		return undefined;
	} catch (error) {
		return describe(error);
	}
}
