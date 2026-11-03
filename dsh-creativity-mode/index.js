/**
 * Creativity mode: a session-scoped working-style switch.
 *
 * The user picks one of three modes. The mode is folded from the session log
 * (`command/run` + `command/done`, which every `/creativity` invocation and
 * every `set_creativity` tool call produces) and exposed to the Client as the
 * `creativity` projection view.
 *
 * Delivery deliberately does NOT change the system prompt: every switch injects
 * one short user-role "style notice" into the conversation, and the system
 * prompt holds a single constant anchor that says the newest notice wins. An
 * in-history model (`deepseek-flash`) appends a full system-prompt copy on
 * every change, so switching through sections would cost ~1.7k tokens and leave
 * stale copies behind; a notice costs ~50-250 tokens and leaves the system
 * prompt byte-identical.
 *
 * Modes:
 * - `divergent` — novelty and breadth first; switches to edit discipline on its
 *   own before the first write/edit.
 * - `balanced` (default) — no special constraints; states that explicitly so a
 *   switch back is never silent.
 * - `faithful` — organize source material without added judgment.
 *
 * State lives in the log, so resume and fork restore the mode. The notice is a
 * user message, so compaction can fold it away; a fresh notice is injected
 * after `compaction/end` and when a session resumes with a non-default mode.
 *
 * @module @local/dsh-creativity-mode
 */

/** Selectable modes, ordered from most usable to most conservative. */
const MODES = Object.freeze(['divergent', 'balanced', 'faithful']);
/** Mode used when the session log carries no selection. */
const DEFAULT_MODE = 'balanced';
/** Projection key and its schema version. */
const PROJECTION_KEY = 'creativity';
const STATE_VERSION = 3;
/** Slash command that switches or reports the mode. */
const COMMAND_NAME = 'creativity';
/** Agent tool that switches the mode on a natural-language request. */
const TOOL_NAME = 'set_creativity';
/** Message-source kind marked on every injected style notice. */
const NOTICE_KIND = 'style';
/** Constant system-prompt anchor name and order (after every tool section). */
const ANCHOR_SECTION = 'creativity:anchor';
const ANCHOR_ORDER = 9500;

/** Accepted spellings, including Chinese terms, mapped to a canonical mode. */
const ALIASES = new Map([
  ['divergent', 'divergent'],
  ['creative', 'divergent'],
  ['creativity', 'divergent'],
  ['brainstorm', 'divergent'],
  ['idea', 'divergent'],
  ['ideas', 'divergent'],
  ['divergence', 'divergent'],
  ['发散', 'divergent'],
  ['创意', 'divergent'],
  ['创新', 'divergent'],
  ['头脑风暴', 'divergent'],
  ['balanced', 'balanced'],
  ['balance', 'balanced'],
  ['default', 'balanced'],
  ['normal', 'balanced'],
  ['平衡', 'balanced'],
  ['默认', 'balanced'],
  ['standard', 'balanced'],
  ['faithful', 'faithful'],
  ['verbatim', 'faithful'],
  ['transcribe', 'faithful'],
  ['fidelity', 'faithful'],
  ['忠实', 'faithful'],
  ['忠实整理', 'faithful'],
  ['照录', 'faithful'],
  ['原文', 'faithful'],
  ['原样', 'faithful'],
]);

/** Style rules carried by the notice of each non-default mode. */
const RULES = {
  divergent: `Optimize for originality and breadth before convention:

- When asked for ideas, give several genuinely different directions (aim for 3-5), not variations of one answer.
- Question the stated framing, and include at least one option a conventional answer would not contain.
- Keep each idea concrete: say what it is, why it could work, and what it costs. Separate fact from speculation and label speculation.
- Do not sand off unusual ideas to look safe; do not pad with generic filler.
- Before your first write or edit, switch to edit discipline: the smallest correct change, the existing conventions, no unrequested refactors or files, and verify what you changed.
- Creativity applies to what to build, not to how you edit.
- When the deliverable is a file, write it and keep the chat reply to its path plus one line of what changed; do not restate the file's content in chat.`,
  faithful: `Organize and format source material without adding your own judgment:

- Keep the source's order, structure, and wording. Do not merge, reorder, or re-level headings unless that exact transformation was requested.
- Do not add conclusions, evaluations, takeaways, or summary paragraphs the source does not contain. Summarize only when the user asks for a summary.
- Do not drop details. If a length limit forces omissions, list exactly what was omitted at the end.
- Do not silently fix contradictions, errors, or inconsistencies. Mark them \`[as written]\` and list them under "open questions".
- Quote where possible. Mark paraphrases as \`(paraphrased)\`.
- Perform only the requested transformation (to Markdown, into one table, grouped by topic). Leave everything else untouched.
- When something is unclear, keep the ambiguity and annotate it; never guess.`,
};

/** Notice text for one mode; balanced states its absence explicitly. */
function noticeText(mode) {
  if (mode === 'balanced') {
    return 'Session style set by the user: balanced (default).\n\nNo special style constraints apply. Any earlier style instruction in this conversation is superseded.';
  }
  return `Session style set by the user: ${mode}.\n\n${RULES[mode] ?? ''}`.trim();
}

/** Collapsed-row summary the Chat UI shows for each notice (language-neutral). */
const NOTICE_SUMMARY = Object.freeze({
  divergent: 'Divergent',
  balanced: 'Balanced',
  faithful: 'Faithful',
});

/**
 * Build one injectable user-role style notice.
 * @param mode - canonical mode the session switched to.
 * @returns an inbox-ready user message.
 */
function buildNotice(mode) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: noticeText(mode) }],
    source: { kind: NOTICE_KIND, form: 'notice', summary: NOTICE_SUMMARY[mode] ?? mode },
  };
}

/** Whether a value is a canonical mode. */
function isMode(value) {
  return value === 'divergent' || value === 'balanced' || value === 'faithful';
}

/**
 * Normalize user or model input to a canonical mode.
 * @param input - raw command argument or tool parameter.
 * @returns the canonical mode, or `undefined` when unrecognized.
 */
function normalizeMode(input) {
  if (typeof input !== 'string') return undefined;
  const token = input.trim().split(/\s+/u)[0];
  if (token === undefined || token === '') return undefined;
  return ALIASES.get(token.toLowerCase());
}

/**
 * Minimal structural validator for the projection state (plain JSON).
 * @returns a `parse`-shaped schema object, the only shape the registry uses.
 */
function stateSchema() {
  return {
    parse(value) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('creativity projection state must be an object');
      }
      if (!isMode(value.mode)) throw new Error('creativity projection mode is not a known mode');
      const running = value.running;
      if (running === null) return { mode: value.mode, running: null };
      if (typeof running !== 'object' || running === null || Array.isArray(running)) {
        throw new Error('creativity projection running must be null or an object');
      }
      if (typeof running.commandId !== 'string' || !isMode(running.mode)) {
        throw new Error('creativity projection running must carry a commandId and a mode');
      }
      return { mode: value.mode, running: { commandId: running.commandId, mode: running.mode } };
    },
  };
}

/** Minimal structural validator for the Client-visible view. */
function viewSchema() {
  return {
    parse(value) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('creativity view must be an object');
      }
      if (!isMode(value.mode)) throw new Error('creativity view mode is not a known mode');
      return { mode: value.mode };
    },
  };
}

/** Build one registered session projection that folds the command lifecycle. */
function projectionDefinition() {
  return {
    key: PROJECTION_KEY,
    stateVersion: STATE_VERSION,
    stateSchema: stateSchema(),
    init: () => ({ mode: DEFAULT_MODE, running: null }),
    apply: (state, event) => {
      if (event.type === 'command/run') {
        if (event.data.name !== COMMAND_NAME) return state;
        const mode = normalizeMode(event.data.args);
        if (mode === undefined) return state;
        const selected = state.running === null ? state.mode : state.running.mode;
        if (mode === selected) return state;
        return {
          mode: state.mode,
          running: { commandId: String(event.data.commandId), mode },
        };
      }
      if (event.type === 'command/done' && state.running !== null) {
        if (String(event.data.commandId) !== state.running.commandId) return state;
        if (event.data.kind !== 'success') return { mode: state.mode, running: null };
        return { mode: state.running.mode, running: null };
      }
      return state;
    },
    wire: {
      viewSchema: viewSchema(),
      view: (state) => ({ mode: state.mode }),
    },
  };
}

/** Services this row registers against. */
export const inject = ['systemPrompt', 'sessionProjections', 'commands', 'tools', 'agents'];

/**
 * Install the creativity switch: constant prompt anchor, projection, notice
 * injection, command, and tool.
 * @param ctx - hosting Cordis context.
 */
export function apply(ctx) {
  /** Read the projection state, falling back to the default mode. */
  const readState = (session) => {
    try {
      const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY);
      if (state !== undefined && isMode(state.mode)) return state;
    } catch {
      // Fall through to the default state.
    }
    return { mode: DEFAULT_MODE, running: null };
  };

  ctx.effect(
    () => ctx.sessionProjections.register(projectionDefinition()),
    'creativity-mode: projection',
  );

  // A constant anchor: the rendered system prompt never depends on the mode, so
  // switching never appends a system-prompt copy.
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: ANCHOR_SECTION,
        order: ANCHOR_ORDER,
        text: '## Session working style\nThe current working style is declared in the most recent `style` notice in this conversation. The newest notice supersedes every earlier one; if no notice exists, no extra style applies.',
      }),
    'creativity-mode: anchor',
  );

  ctx.commands.register({
    definitionId: '@local/dsh-creativity-mode',
    name: COMMAND_NAME,
    description:
      'Show or switch the session creativity mode (divergent | balanced | faithful)',
    input: { hint: '[divergent|balanced|faithful]' },
    handler: ({ agent, rawInput }) => {
      const raw = rawInput.trim();
      const state = readState(agent.session);
      if (raw === '' || raw === '?' || raw.toLowerCase() === 'status') {
        return {
          kind: 'success',
          text: `Creativity mode: ${state.mode}. Options: ${MODES.join(', ')}.`,
        };
      }
      const mode = normalizeMode(raw);
      if (mode === undefined) {
        return {
          kind: 'error',
          text: `Unknown creativity mode "${raw}". Options: ${MODES.join(', ')}.`,
        };
      }
      if (mode === state.mode) {
        return {
          kind: 'success',
          text: `Creativity mode is already ${mode}.`,
        };
      }
      agent.inject(buildNotice(mode));
      return {
        kind: 'success',
        text: `Creativity mode set to ${mode} — a style notice was injected; it applies from the next model step.`,
      };
    },
  });

  // Activation on a live profile does not re-create existing agents, so restate
  // the mode of any live non-default session once when this row loads.
  for (const agent of ctx.agents.list()) {
    const state = readState(agent.session);
    if (state.mode === DEFAULT_MODE) continue;
    agent.inject(buildNotice(state.mode));
  }

  // Compaction folds the notice into its summary; restate the current mode so a
  // long session does not silently fall back to the default.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'compaction/end' || event.data.error !== undefined) return;
    const state = readState(session);
    if (state.mode === DEFAULT_MODE) return;
    const agent = ctx.agents.get(session.id);
    if (agent === undefined) return;
    agent.inject(buildNotice(state.mode));
  });

  // A resumed or forked session may have lost its notice to compaction; restate
  // non-default modes when the agent is created.
  ctx.on('agent/created', ({ agent }) => {
    const state = readState(agent.session);
    if (state.mode === DEFAULT_MODE) return;
    agent.inject(buildNotice(state.mode));
  });

  ctx.tools.register({
    name: TOOL_NAME,
    description:
      'Switch this session\'s creativity mode. Call it when the user asks for bolder, more original or more divergent ideas (`divergent`), for faithful organizing and transcription of source material without added judgment (`faithful`), or to return to the default (`balanced`). The setting persists in the session and changes later steps, not the current reply.',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: MODES.slice(),
          description:
            'divergent = originality and breadth, with edit discipline once files change; balanced = default; faithful = keep source order and wording, add no judgment or summary.',
        },
      },
      required: ['level'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: MODES.slice() },
        },
        required: ['level'],
        additionalProperties: false,
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Creativity mode is now ${value.level}. It applies from the next model step.`,
        },
      ],
    },
    execute: async (args, exec) => {
      const mode = normalizeMode(args?.level);
      if (mode === undefined) {
        throw new Error(`set_creativity needs one of: ${MODES.join(', ')}`);
      }
      const agent = exec.agent;
      if (agent === undefined) {
        throw new Error('set_creativity requires a calling agent');
      }
      const execution = await ctx.commands.execute(
        agent,
        `/${COMMAND_NAME} ${mode}`,
        [],
        exec.signal,
      );
      if (execution === undefined) {
        throw new Error(`the /${COMMAND_NAME} command is not registered`);
      }
      if (execution.result.kind === 'error') {
        throw new Error(execution.result.text);
      }
      return { level: mode };
    },
  });
}
