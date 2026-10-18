// Tool catalogue the model may call, and the rule for which calls run
// automatically versus which need the user's confirmation on their PC.
//
// Safety model (defence in depth):
//   1. The runner (on the PC) is the real boundary: it refuses any path
//      outside the work folder and never truly deletes (files go to Recycle
//      Bin). The server cannot override that.
//   2. This file is the policy layer: "risky" actions are held for approval
//      even if the runner would allow them.
//   3. The user picks the work folder and approves risky actions.

/** Gemini function declarations advertised to the model. */
export const TOOL_DECLARATIONS = [
  {
    name: 'list_dir',
    description: 'List files and folders inside a path, relative to the work folder. Use "." for the work folder root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Folder path relative to the work folder, e.g. "." or "src".' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the work folder and return its contents.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the work folder.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file inside the work folder. Overwriting replaces the whole file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the work folder.' },
        content: { type: 'string', description: 'The full new contents of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Move a file or folder to the Windows Recycle Bin (not a permanent delete). Inside the work folder only.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File or folder path relative to the work folder.' } },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the work folder and return its output. Use for build/test/git tasks, e.g. "npm test", "git status", "python script.py". Does not support interactive prompts.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command line to run.' } },
      required: ['command'],
    },
  },
];

/** Tools that only read: always safe, never need approval. */
const READ_ONLY = new Set(['list_dir', 'read_file']);

// Commands considered safe to run without asking. Anything not matching is risky.
const SAFE_COMMAND = [
  /^npm (test|run (test|lint|build|typecheck)|ci|install)\b/,
  /^(yarn|pnpm) (test|lint|build|install)\b/,
  /^npx tsc\b/,
  /^git (status|diff|log|branch|show|add|restore|stash list)\b/,
  /^(ls|dir|pwd|cat|type|echo|node --version|npm --version|python --version)\b/,
  /^python3? (-m pytest|[\w./-]+\.py)\b/,
  /^pytest\b/,
];

// Command fragments that are always risky, even inside an otherwise-safe line.
const DANGEROUS_FRAGMENT = /(\brm\b|\bdel\b|\brmdir\b|\bformat\b|\bcurl\b|\bwget\b|\bInvoke-WebRequest\b|\bgit push\b|\bshutdown\b|\breg\b|\bnpm publish\b|>|\||&|;|`|\$\()/i;

/**
 * Decide whether a tool call needs the user's approval.
 * Returns { risky: boolean, reason: string }.
 */
export function classify(name, args) {
  if (READ_ONLY.has(name)) return { risky: false, reason: '' };
  if (name === 'write_file') return { risky: false, reason: 'creates or overwrites a file in the work folder' };
  if (name === 'delete_file') return { risky: true, reason: 'moves a file to the Recycle Bin' };
  if (name === 'run_command') {
    const cmd = String(args?.command ?? '').trim();
    if (DANGEROUS_FRAGMENT.test(cmd)) return { risky: true, reason: 'command can modify the system, delete data, or use the network' };
    if (SAFE_COMMAND.some((re) => re.test(cmd))) return { risky: false, reason: '' };
    return { risky: true, reason: 'command is not on the known-safe list' };
  }
  return { risky: true, reason: 'unknown tool' };
}

/** A short, human-readable summary of a tool call for the approval prompt. */
export function describe(name, args) {
  switch (name) {
    case 'list_dir':
      return `List folder: ${args?.path ?? '.'}`;
    case 'read_file':
      return `Read file: ${args?.path}`;
    case 'write_file':
      return `Write file: ${args?.path} (${String(args?.content ?? '').length} chars)`;
    case 'delete_file':
      return `Recycle: ${args?.path}`;
    case 'run_command':
      return `Run: ${args?.command}`;
    default:
      return `${name} ${JSON.stringify(args)}`;
  }
}
