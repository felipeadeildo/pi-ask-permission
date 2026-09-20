export const DEFAULT_POLICY = `# May run without asking
- Reading, searching, and listing files
- Editing files inside the project
- Running tests, linters, type checks, builds, and formatters
- git status, diff, log, add, and commit

# Must always ask first
- sudo, or anything that changes state outside the project
- Installing or upgrading global packages
- Pushing, force operations, or rewriting history
- Downloading and running remote scripts
- Deleting files outside the project, or recursive deletes

# When in doubt
Ask me.
`;

export interface PolicyPreset {
	id: string;
	label: string;
	description: string;
	policy: string;
}

export const POLICY_TEMPLATE = `# May run without asking
- Reading, searching, and listing files
- Running tests, linters, and type checks

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
		id: "locked",
		label: "Locked down",
		description: "Read-only. Any write, install, or network call asks you.",
		policy: `# May run without asking
- Reading, searching, and listing files
- Running the existing tests, linter, and type checker

# Must always ask first
- Anything that writes, creates, moves, or deletes a file
- Anything that installs or upgrades a package
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
			"Edits, tests, builds, and local git. Installs, network, and destructive commands ask you.",
		policy: DEFAULT_POLICY,
	},
	{
		id: "autonomous",
		label: "Autonomous",
		description:
			"Adds installs and network reads. sudo, credentials, and destructive commands still ask you.",
		policy: `# May run without asking
- Reading, searching, listing, and editing files inside the project
- Running tests, builds, formatters, and project scripts
- Installing project-local dependencies
- Fetching dependencies and other network reads
- git status, diff, log, add, commit, and branch operations

# Must always ask first
- sudo, or anything that changes system-wide state
- Reading or writing credentials, tokens, or private keys
- Uploading data to a host you did not name
- Force-pushing or deleting a published branch
- Deleting files outside the project, or recursive deletes

# When in doubt
Ask me.
`,
	},
	{
		id: "custom",
		label: "Custom",
		description: "Your own rules, written in the editor.",
		policy: "",
	},
];

export function detectPolicyPreset(policy: string): string {
	const match = POLICY_PRESETS.find((preset) => preset.id !== "custom" && preset.policy === policy);
	return match ? match.id : "custom";
}

export function getPolicyPreset(id: string): PolicyPreset | undefined {
	return POLICY_PRESETS.find((preset) => preset.id === id);
}

export const MAX_POLICY_CHARS = 8000;

export function policyWarning(policy: string): string | undefined {
	const trimmed = policy.trim();
	if (trimmed === "")
		return "no policy set. Pick a preset in /perm or the judge will ask you about everything.";
	if (trimmed.length > MAX_POLICY_CHARS)
		return `policy is ${trimmed.length} characters; keep it under ${MAX_POLICY_CHARS} for reliable judging`;
	return undefined;
}
