/**
 * Small, composable decoders for data that arrives as `unknown`: the config
 * file, the grants file, and model responses. Every decoder is total — it
 * either produces a value or a list of problems, and never throws. This is the
 * only module that inspects `typeof`; everything else works with typed values.
 */

export interface Problem {
	path: string;
	message: string;
}

export type Decoded<T> =
	| { ok: true; value: T; problems: Problem[] }
	| { ok: false; problems: Problem[] };

export interface Decoder<T> {
	decode(input: unknown, path: string): Decoded<T>;
}

export function pass<T>(value: T, problems: Problem[] = []): Decoded<T> {
	return { ok: true, value, problems };
}

export function fail<T>(problem: Problem): Decoded<T> {
	return { ok: false, problems: [problem] };
}

export function problem(path: string, message: string): Problem {
	return { path, message };
}

export function fieldPath(path: string, key: string): string {
	return path === "" ? key : `${path}.${key}`;
}

/** `["path.line", "message"]`, the shape every warning in this project uses. */
export function formatProblems(problems: Problem[]): string[] {
	return problems.map((entry) => `${entry.path}: ${entry.message}`);
}

export function isObject(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

export const string: Decoder<string> = {
	decode(input, path) {
		return typeof input === "string" ? pass(input) : fail(problem(path, "expected a string"));
	},
};

export const trimmedString: Decoder<string> = {
	decode(input, path) {
		if (typeof input !== "string" || input.trim() === "")
			return fail(problem(path, "expected a non-empty string"));
		return pass(input.trim());
	},
};

export const boolean: Decoder<boolean> = {
	decode(input, path) {
		return typeof input === "boolean" ? pass(input) : fail(problem(path, "expected a boolean"));
	},
};

export const unit: Decoder<number> = {
	decode(input, path) {
		if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1)
			return fail(problem(path, "expected a number from 0 to 1"));
		return pass(input);
	},
};

export const duration: Decoder<number> = {
	decode(input, path) {
		if (typeof input !== "number" || !Number.isFinite(input) || input < 0)
			return fail(problem(path, "expected a non-negative number of milliseconds"));
		return pass(input);
	},
};

export function literal<const T extends readonly string[]>(...values: T): Decoder<T[number]> {
	const expected = values.map((value) => `"${value}"`).join(" or ");
	return {
		decode(input, path) {
			if (typeof input === "string" && (values as readonly string[]).includes(input))
				return pass(input as T[number]);
			return fail(problem(path, `expected ${expected}`));
		},
	};
}

export function nullable<T>(inner: Decoder<T>): Decoder<T | null> {
	return {
		decode(input, path) {
			return input === null ? pass(null) : inner.decode(input, path);
		},
	};
}

/**
 * A missing value is fine and uses the fallback silently. A present but invalid
 * value also uses the fallback, but reports why — a typo never weakens a guard
 * without a word.
 */
export function withDefaultOf<T>(inner: Decoder<T>, fallback: () => T): Decoder<T> {
	return {
		decode(input, path) {
			if (input === undefined) return pass(fallback());
			const result = inner.decode(input, path);
			return result.ok ? result : pass(fallback(), result.problems);
		},
	};
}

export function withDefault<T>(inner: Decoder<T>, fallback: T): Decoder<T> {
	return withDefaultOf(inner, () => fallback);
}

/**
 * Non-empty strings, dropping anything else. The whole list is reported once,
 * so a sloppy array is one warning rather than one per bad entry.
 */
export function stringList(expected: string): Decoder<string[]> {
	const notAList = `expected an array of ${expected}`;
	const dropped = "ignored entries that are not non-empty strings";

	return {
		decode(input, path) {
			if (!Array.isArray(input)) return fail(problem(path, notAList));

			const value: string[] = [];
			let missing = 0;
			for (const entry of input) {
				if (typeof entry === "string" && entry !== "") value.push(entry);
				else missing++;
			}

			const problems = missing > 0 ? [problem(path, dropped)] : [];
			return pass(value, problems);
		},
	};
}

/** Missing uses the fallback. Present but unusable narrows to nothing. */
export function stringListOrEmpty(
	fallback: readonly string[],
	expected: string,
): Decoder<string[]> {
	const parse = stringList(expected);
	return {
		decode(input, path) {
			if (input === undefined) return pass([...fallback]);
			const result = parse.decode(input, path);
			return result.ok ? result : pass([], result.problems);
		},
	};
}

export function object<T extends Record<string, unknown>>(shape: {
	[K in keyof T]: Decoder<T[K]>;
}): Decoder<T> {
	return {
		decode(input, path) {
			if (!isObject(input)) return fail(problem(path, "expected an object"));

			const problems: Problem[] = [];
			const value = {} as T;
			let complete = true;

			for (const key of Object.keys(shape) as (keyof T & string)[]) {
				const result = shape[key].decode(input[key], fieldPath(path, key));
				problems.push(...result.problems);
				if (result.ok) value[key] = result.value;
				else complete = false;
			}

			return complete ? pass(value, problems) : { ok: false, problems };
		},
	};
}
