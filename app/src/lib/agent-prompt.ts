export interface AgentPersonaPrompt {
  name: string;
  prompt: string;
}

export interface AgentSystemParts {
  /** Settings → AI → Agent → global system prompt. */
  globalPrompt?: string;
  /** Persona selected for this conversation, or null for none. */
  persona?: AgentPersonaPrompt | null;
  /** Workspace/active-note context built by the panel. */
  vaultContext?: string;
  noteContext?: string;
}

/**
 * Compose the `system` message for one agent request.
 *
 * There is deliberately no built-in text here: 5.1.3 removed the hardcoded
 * "act first" prompt so the user owns the whole instruction. Order is:
 * global prompt → active persona → vault context → active note. Persona
 * text is appended (not replacing) so a persona can specialise the global
 * rules without silently dropping them.
 */
export function composeAgentSystemPrompt(parts: AgentSystemParts): string {
  const out: string[] = [];

  const global = parts.globalPrompt?.trim();
  if (global) out.push(global);

  const personaPrompt = parts.persona?.prompt.trim();
  if (personaPrompt) {
    const name = parts.persona?.name.trim();
    out.push(name ? `## Persona: ${name}\n${personaPrompt}` : personaPrompt);
  }

  const vault = parts.vaultContext?.trim();
  if (vault) out.push(vault);

  const note = parts.noteContext?.trim();
  if (note) out.push(note);

  return out.join('\n\n');
}
