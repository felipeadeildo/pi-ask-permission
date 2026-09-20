import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { TYPESAFE_BASE_URL, TYPESAFE_PROVIDER } from "#core/judge/index.ts";

export function registerTypesafeProvider(pi: ExtensionAPI): void {
	pi.registerProvider(TYPESAFE_PROVIDER, {
		name: "TypeSafe (Jev)",
		baseUrl: TYPESAFE_BASE_URL,
		apiKey: "$TYPESAFE_API_KEY",
	});
}
