/**
 * Creativity mode: a session-scoped "how to think" switch.
 *
 * The user picks one of four modes; the mode is folded from the session log
 * (`command/run` + `command/done`, which every `/creativity` invocation and
 * every `set_creativity` tool call produces), exposed to the Client as the
 * `creativity` projection view, and rendered as an extra prompt section for
 * every model step while a non-default mode is active.
 *
 * Modes:
 * - `divergent` — novelty and breadth first: several genuinely different
 *   options, questioned assumptions, non-obvious proposals.
 * - `balanced` (default) — no extra guidance at all; the deployment prompt is
 *   untouched, so this mode costs no tokens.
 * - `strict` — minimal, exact, verifiable execution: no unrequested scope.
 * - `auto` — phase policy: starts divergent, and the first `write`/`edit` tool
 *   call flips the session to strict. Re-selecting `auto` restarts ideation.
 *
 * State lives in the log, so resume and fork restore the mode, and no new
 * event type is introduced (the command lifecycle already carries it; the auto
 * phase flip folds the model's own `tool/call` events).
 *
 * @module @local/dsh-creativity-mode
 */

/** Selectable modes, ordered from most divergent to most precise. */
const MODES = Object.freeze(['divergent', 'balanced', 'strict', 'auto']);
/** Mode used when the session log carries no selection. */
const DEFAULT_MODE = 'balanced';
/** Projection key and its schema version. */
const PROJECTION_KEY = 'creativity';
const STATE_VERSION = 2;
/** Slash command that switches or reports the mode. */
const COMMAND_NAME = 'creativity';
/** Agent tool that switches the mode on a natural-language request. */
const TOOL_NAME = 'set_creativity';
/**
 * Tools whose first call ends the auto-mode idea phase.
 *
 * Only unambiguous file mutations count: a `bash` call may be a read, a test,
 * or a write, so it cannot serve as the boundary.
 */
const MUTATING_TOOLS = Object.freeze(new Set(['write', 'edit']));

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
  ['strict', 'strict'],
  ['precise', 'strict'],
  ['precision', 'strict'],
  ['exact', 'strict'],
  ['execution', 'strict'],
  ['execute', 'strict'],
  ['严谨', 'strict'],
  ['严格', 'strict'],
  ['执行', 'strict'],
  ['精确', 'strict'],
  ['auto', 'auto'],
  ['automatic', 'auto'],
  ['phase', 'auto'],
  ['自动', 'auto'],
  ['自适应', 'auto'],
  ['自动切换', 'auto'],
]);

/**
 * Model-facing guidance for one non-default effective level.
 *
 * Balanced deliberately has no entry: an empty section keeps the default
 * request byte-identical and avoids a permanent token cost.
 */
const GUIDANCE = {
  divergent: `## Session working style: creative (divergent)

The user set this session to divergent mode. Optimize for originality and breadth before convention:

- When asked for ideas, give several genuinely different directions (aim for 3-5), not variations of one answer.
- Question the stated framing, surface non-obvious connections, and include at least one option a conventional answer would not contain.
- Keep each idea concrete: say what it is, why it could work, and what it costs. Separate fact from speculation and label speculation.
- Do not sand off unusual ideas to look safe; do not pad with generic filler.
- Execution is still execution: when the user asks you to carry out a specific task, follow their explicit requirements and do not break working code. Creativity applies to what to build, not to ignoring constraints.
- When the deliverable is a file (a document, a note, a summary to keep), write it and keep the chat reply to its path plus one line of what changed; do not restate the file's content in chat.
- When the discussion converges and you are about to change files: in manual divergent mode call set_creativity with "strict" first; in auto mode the harness switches for you.`,
  strict: `## Session working style: precise (strict)

The user set this session to strict mode. Optimize for predictable, minimal, verifiable work:

- Do exactly what was asked. Do not add unrequested features, files, refactors, renames, or stylistic changes.
- When the deliverable is a file (a document, a note, a summary to keep), write it and keep the chat reply to its path plus one line of what changed; do not restate the file's content in chat.
- Prefer the smallest correct change and follow the existing conventions of the codebase.
- When requirements are ambiguous, state the assumption you are making in one line and proceed on the narrowest reading; ask only when the choice changes the outcome.
- Verify in proportion to risk: run the check for code changes; for a document, read it once and stop instead of running code checks on prose.
- Do not brainstorm alternatives unless the user asks for options; when a choice is unavoidable, take the conventional option and say why in one line.
- If the user asks for fresh options or ideas rather than a fix, call set_creativity with "auto" (or "divergent") before proposing them.`,
};

/** Auto-mode note appended after the effective level's guidance. */
const AUTO_IDEATE_NOTE = `### Auto mode — idea phase

This session is in auto mode. Propose directions before implementation: describe the choices, their trade-offs, and what you would build. Do not call set_creativity for this transition: the harness switches this session to strict automatically when you first call the write or edit tool. If the user's request is already a concrete execution task with no design choice left, edit directly — that is the same transition.`;

const AUTO_EXECUTE_NOTE = `### Auto mode — execution phase

This session is in auto mode and has already moved from the idea phase to implementation (the first file edit did that). Continue under the strict guidance above. To explore again, the user re-selects Auto or Divergent.`;

/** Whether a value is a canonical effective level (no `auto`). */
function isLevel(value) {
  return value === 'divergent' || value === 'balanced' || value === 'strict';
}

/** Whether a value is a canonical selectable mode. */
function isMode(value) {
  return value === 'auto' || isLevel(value);
}

/** Whether a value is a valid auto phase. */
function isPhase(value) {
  return value === 'ideate' || value === 'execute';
}

/**
 * The level whose guidance a state renders right now.
 * @param state - projection state.
 * @returns `divergent`, `balanced`, or `strict`.
 */
function effectiveLevel(state) {
  if (state.mode === 'auto') return state.phase === 'execute' ? 'strict' : 'divergent';
  return isLevel(state.mode) ? state.mode : DEFAULT_MODE;
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
      const mode = value.mode;
      if (!isMode(mode)) throw new Error('creativity projection mode is not a known mode');
      const phase = value.phase;
      if (!isPhase(phase)) throw new Error('creativity projection phase is not a known phase');
      const running = value.running;
      if (running === null) return { mode, phase, running: null };
      if (typeof running !== 'object' || running === null || Array.isArray(running)) {
        throw new Error('creativity projection running must be null or an object');
      }
      if (typeof running.commandId !== 'string' || !isMode(running.mode)) {
        throw new Error('creativity projection running must carry a commandId and a mode');
      }
      return { mode, phase, running: { commandId: running.commandId, mode: running.mode } };
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
      if (!isLevel(value.level)) throw new Error('creativity view level is not a known level');
      if (!isPhase(value.phase)) throw new Error('creativity view phase is not a known phase');
      if (value.pending !== null && !isLevel(value.pending)) {
        throw new Error('creativity view pending must be null or a known level');
      }
      return { mode: value.mode, level: value.level, phase: value.phase, pending: value.pending };
    },
  };
}

/** Build one registered session projection that folds the command lifecycle. */
function projectionDefinition() {
  return {
    key: PROJECTION_KEY,
    stateVersion: STATE_VERSION,
    stateSchema: stateSchema(),
    init: () => ({ mode: DEFAULT_MODE, phase: 'ideate', running: null }),
    apply: (state, event) => {
      if (event.type === 'command/run') {
        if (event.data.name !== COMMAND_NAME) return state;
        const mode = normalizeMode(event.data.args);
        if (mode === undefined) return state;
        const selected = state.running === null ? state.mode : state.running.mode;
        // Re-selecting auto restarts ideation even though the mode is unchanged.
        if (mode === selected && !(mode === 'auto' && state.phase === 'execute')) return state;
        return {
          mode: state.mode,
          phase: state.phase,
          running: { commandId: String(event.data.commandId), mode },
        };
      }
      if (event.type === 'command/done' && state.running !== null) {
        if (String(event.data.commandId) !== state.running.commandId) return state;
        if (event.data.kind !== 'success') return { mode: state.mode, phase: state.phase, running: null };
        return { mode: state.running.mode, phase: 'ideate', running: null };
      }
      if (event.type === 'tool/call') {
        if (state.mode !== 'auto' || state.phase === 'execute') return state;
        if (!MUTATING_TOOLS.has(event.data.name)) return state;
        return { mode: state.mode, phase: 'execute', running: state.running };
      }
      return state;
    },
    wire: {
      viewSchema: viewSchema(),
      view: (state) => ({
        mode: state.mode,
        level: effectiveLevel(state),
        phase: state.phase,
        pending: state.running === null ? null : state.running.mode,
      }),
    },
  };
}

/** Services this row registers against. */
export const inject = ['systemPrompt', 'sessionProjections', 'commands', 'tools'];

/** Prompt section name (unique in the prompt registry). */
const SECTION_NAME = 'creativity:policy';

/**
 * Install the creativity switch: prompt section, projection, command, and tool.
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
    return { mode: DEFAULT_MODE, phase: 'ideate', running: null };
  };

  ctx.effect(
    () => ctx.sessionProjections.register(projectionDefinition()),
    'creativity-mode: projection',
  );

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY') + 10,
        text: (context) => {
          const agent = context?.agent;
          if (agent === undefined) return '';
          const state = readState(agent.session);
          const level = effectiveLevel(state);
          const base = GUIDANCE[level] ?? '';
          if (state.mode !== 'auto') return base;
          return `${base}\n\n${state.phase === 'execute' ? AUTO_EXECUTE_NOTE : AUTO_IDEATE_NOTE}`;
        },
      }),
    'creativity-mode: prompt section',
  );

  ctx.commands.register({
    definitionId: '@local/dsh-creativity-mode',
    name: COMMAND_NAME,
    description:
      'Show or switch the session creativity mode (divergent | balanced | strict | auto)',
    input: { hint: '[divergent|balanced|strict|auto]' },
    handler: ({ agent, rawInput }) => {
      const raw = rawInput.trim();
      const state = readState(agent.session);
      const level = effectiveLevel(state);
      const where = state.mode === 'auto' ? `auto (currently ${level})` : level;
      if (raw === '' || raw === '?' || raw.toLowerCase() === 'status') {
        return {
          kind: 'success',
          text: `Creativity mode: ${where}. Options: ${MODES.join(', ')}.`,
        };
      }
      const mode = normalizeMode(raw);
      if (mode === undefined) {
        return {
          kind: 'error',
          text: `Unknown creativity mode "${raw}". Options: ${MODES.join(', ')}.`,
        };
      }
      const restartAuto = mode === 'auto' && state.mode === 'auto' && state.phase === 'execute';
      if (mode === state.mode && !restartAuto) {
        return {
          kind: 'success',
          text: `Creativity mode is already ${mode}.`,
        };
      }
      const text =
        mode === 'auto'
          ? 'Creativity mode set to auto — divergent until the first file edit, then strict. Applies from the next model step.'
          : `Creativity mode set to ${mode} — applies from the next model step.`;
      return { kind: 'success', text };
    },
  });

  ctx.tools.register({
    name: TOOL_NAME,
    description:
      'Switch this session\'s creativity mode. Call it when the user asks for bolder, more original or more divergent ideas (`divergent`), for strict step-by-step minimal execution (`strict`), for the default (`balanced`), or for an automatic phase policy that starts divergent and turns strict at the first file edit (`auto`). The setting persists in the session and changes later steps, not the current reply.',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: MODES.slice(),
          description:
            'divergent = originality and breadth; balanced = default; strict = minimal and exact; auto = divergent first, strict after the first file edit.',
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
          text:
            value.level === 'auto'
              ? 'Creativity mode is now auto: divergent until the first file edit, then strict. It applies from the next model step.'
              : `Creativity mode is now ${value.level}. It applies from the next model step.`,
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
