import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBashTimer } from "#pi/bash-timer.ts";
import { registerCommands } from "#pi/commands.ts";
import { registerEvents } from "#pi/events.ts";
import { registerTypesafeProvider } from "#pi/provider.ts";
import { createSession } from "#pi/session.ts";
import { registerJudgeEntry } from "#ui/judge-entry.ts";

export default function piAskPermission(pi: ExtensionAPI) {
	registerBashTimer(pi);
	registerTypesafeProvider(pi);
	registerJudgeEntry(pi);

	const session = createSession();
	registerEvents(pi, session);
	registerCommands(pi, session);
}
