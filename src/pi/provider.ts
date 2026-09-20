import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { TYPESAFE_BASE_URL, TYPESAFE_PROVIDER } from "#core/judge/index.ts";

/**
 * Auth-only provider: `/login typesafe` and `$TYPESAFE_API_KEY` both work, and
 * with no models it never joins the model picker.
 */
export function registerTypesafeProvider(pi: ExtensionAPI): void {
	pi.registerProvider(TYPESAFE_PROVIDER, {
		name: "TypeSafe (Jev)",
		baseUrl: TYPESAFE_BASE_URL,
		apiKey: "$TYPESAFE_API_KEY",
	});
}
