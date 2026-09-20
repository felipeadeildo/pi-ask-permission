import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface ClipboardImage {
	bytes: Uint8Array;
	mimeType: string;
}

interface ClipboardReader {
	readClipboardImage: () => Promise<ClipboardImage | null>;
	readClipboardText: () => Promise<string | null>;
	extensionForImageMimeType: (mimeType: string) => string | null;
}

let loaded: Promise<ClipboardReader | null> | undefined;

/** pi does not export its clipboard reader, so reach into its dist. Null if that ever moves. */
function loadClipboard(): Promise<ClipboardReader | null> {
	loaded ??= (async () => {
		try {
			const root = import.meta.resolve("@earendil-works/pi-coding-agent");
			const images = await import(new URL("./utils/clipboard-image.js", root).href);
			const text = await import(new URL("./utils/clipboard.js", root).href);
			return {
				readClipboardImage: images.readClipboardImage,
				extensionForImageMimeType: images.extensionForImageMimeType,
				readClipboardText: text.readClipboardText,
			};
		} catch {
			return null;
		}
	})();

	return loaded;
}

/** A clipboard image comes back as its temp file path, anything else as text. */
export async function readClipboard(): Promise<string | null> {
	const clipboard = await loadClipboard();
	if (!clipboard) return null;

	const image = await clipboard.readClipboardImage();
	if (image) {
		const extension = clipboard.extensionForImageMimeType(image.mimeType) ?? "png";
		const path = join(tmpdir(), `pi-ask-permission-${randomUUID()}.${extension}`);
		writeFileSync(path, Buffer.from(image.bytes));
		return path;
	}

	return clipboard.readClipboardText();
}
