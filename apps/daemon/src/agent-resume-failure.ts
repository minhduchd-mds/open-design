// Signatures Claude Code prints to stderr when a `--resume <id>` target no
// longer exists on disk (session pruned, repo moved machines, ~/.claude
// cleared). Keep this helper pure so runtime recovery and analytics
// classification can both use the same matcher without pulling in DB state.
const CLAUDE_RESUME_FAILURE_PATTERNS: RegExp[] = [
  /no conversation found with session id/i,
  /no session found/i,
  /session .* not found/i,
];

/** True when CLI output indicates a resume target session is missing. */
export function isClaudeResumeFailure(text: string): boolean {
  if (!text) return false;
  return CLAUDE_RESUME_FAILURE_PATTERNS.some((re) => re.test(text));
}
