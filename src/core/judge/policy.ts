/**
 * Starter policies. The operator's policy is the authoritative rulebook the
 * judge reads, so these are written as plain rules a person would hand to a
 * colleague: what may run, what always asks, and what to do when unsure.
 */

export interface PolicyPreset {
	id: string;
	label: string;
	description: string;
	policy: string;
}

/** Shown when the editor opens with no policy yet. The user edits or replaces it. */
export const POLICY_TEMPLATE = `# May run without asking
- Reading, searching, listing, and inspecting files
- Running tests, linters, type checks, and formatters

# Must always ask first
- Anything that writes, deletes, or moves files
- Anything that installs or upgrades packages
- Anything that reaches the network
- Anything that touches credentials, tokens, or private keys

# When in doubt
Ask me.
`;

export const POLICY_PRESETS: PolicyPreset[] = [
	{
		id: "read-only",
		label: "Read-only & tests",
		description:
			"Inspect files and run tests. Anything that writes, installs, or uses the network asks first.",
		policy: `# May run without asking
- Reading, searching, listing, and inspecting files
- Running the existing test suite, linter, and type checker
- git status, git diff, and git log

# Must always ask first
- Anything that writes, creates, moves, or deletes files
- Anything that installs, upgrades, or removes packages
- Anything that reaches the network
- Anything that changes git history or the remote

# When in doubt
Ask me.
`,
	},
	{
		id: "standard",
		label: "Standard development",
		description:
			"Everyday local work: tests, builds, formatters, and local git. Network and destructive commands ask first.",
		policy: `# May run without asking
- Reading, searching, listing, and inspecting files
- Running tests, linters, type checks, builds, and formatters
- git status, diff, log, add, and commit
- Creating or editing files inside the project

# Must always ask first
- sudo, or anything that changes system-wide state
- Installing or upgrading global packages
- Pushing to a remote, force operations, or rewriting history
- Network uploads, and commands that pipe downloads into a shell
- Deleting files outside the project, or recursive deletes

# When in doubt
Ask me.
`,
	},
	{
		id: "sandbox",
		label: "Trusted sandbox",
		description:
			"Allow most local work, including installs and edits, except destructive or credential-touching commands.",
		policy: `# May run without asking
- Reading, searching, listing, and editing files inside the project
- Running tests, builds, formatters, and local scripts
- Installing project-local dependencies
- git status, diff, log, add, commit, and branch operations

# Must always ask first
- sudo, or anything that changes system-wide state
- Commands that read or write credentials, tokens, or private keys
- Sending data to hosts outside the local machine
- Deleting files outside the project, or recursive deletes
- Force-pushing or rewriting published history

# When in doubt
Ask me.
`,
	},
	{
		id: "custom",
		label: "Custom",
		description: "Write your own policy. The judge treats it as the authoritative rulebook.",
		policy: "",
	},
];

/** The preset whose policy matches exactly, or "custom" for anything hand-written. */
export function detectPolicyPreset(policy: string): string {
	const match = POLICY_PRESETS.find((preset) => preset.id !== "custom" && preset.policy === policy);
	return match ? match.id : "custom";
}

export function getPolicyPreset(id: string): PolicyPreset | undefined {
	return POLICY_PRESETS.find((preset) => preset.id === id);
}

/** Soft cap: a policy longer than this is probably a mistake, not a rulebook. */
export const MAX_POLICY_CHARS = 8000;

export function policyWarning(policy: string): string | undefined {
	const trimmed = policy.trim();
	if (trimmed === "") return "no policy yet: the judge will send almost everything to you";
	if (trimmed.length > MAX_POLICY_CHARS)
		return `policy is ${trimmed.length} characters; keep it under ${MAX_POLICY_CHARS} for reliable judging`;
	return undefined;
}
