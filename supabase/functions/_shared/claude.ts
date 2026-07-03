/** Default model for Messages API — override via CLAUDE_MODEL secret. */
export const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-4-6'
