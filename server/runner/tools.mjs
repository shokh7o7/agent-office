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

/**
 * Every tool the server knows. A runner advertises which ones it implements
 * (capabilities); the model is only offered those. Runners that report nothing
 * (older builds) get BASE_TOOLS.
 */
const DECLARATIONS = {
  list_dir: {
    name: 'list_dir',
    description: 'List files and folders directly inside a path, relative to the work folder. Use "." for the root.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder path relative to the work folder.' } }, required: ['path'] },
  },
  list_tree: {
    name: 'list_tree',
    description:
      'Show the folder structure recursively (skips .git, node_modules, bin, obj, dist, build, .venv, __pycache__). ' +
      'Use this FIRST to understand a project before reading or changing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder relative to the work folder, default ".".' },
        depth: { type: 'integer', description: 'How many levels deep, 1-6. Default 4.' },
      },
      required: [],
    },
  },
  search_files: {
    name: 'search_files',
    description:
      'Search text in files under a folder (case-insensitive, plain text). Returns file, line number and the line. ' +
      'Use it to find where something is defined or used before editing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find.' },
        path: { type: 'string', description: 'Folder to search, default ".".' },
        glob: { type: 'string', description: 'Optional file filter like "*.ts" or "*.css".' },
      },
      required: ['query'],
    },
  },
  read_file: {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the work folder.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to the work folder.' } }, required: ['path'] },
  },
  read_file_lines: {
    name: 'read_file',
    description:
      'Read a UTF-8 text file inside the work folder. Optionally pass start_line/end_line (1-based, inclusive) to read part ' +
      'of a large file; ranged reads come back with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the work folder.' },
        start_line: { type: 'integer', description: 'First line to return (1-based).' },
        end_line: { type: 'integer', description: 'Last line to return (inclusive).' },
      },
      required: ['path'],
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Create a new file or fully overwrite a file inside the work folder. For small changes to existing files prefer edit_file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string', description: 'The full new contents of the file.' } },
      required: ['path', 'content'],
    },
  },
  edit_file: {
    name: 'edit_file',
    description:
      'Replace one exact piece of text in an existing file. old_text must appear exactly once (include enough surrounding ' +
      'lines to make it unique). Preferred over write_file for changing existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string', description: 'Exact text currently in the file, appearing once.' },
        new_text: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  delete_file: {
    name: 'delete_file',
    description: 'Move a file or folder to the Recycle Bin (not a permanent delete). Inside the work folder only.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  run_command: {
    name: 'run_command',
    description:
      'Run a shell command in the work folder (PowerShell on Windows) and return exit code and output. Use it to build, ' +
      'test, lint and check your work. No interactive prompts; long-running servers will time out.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
};

export const BASE_TOOLS = ['list_dir', 'read_file', 'write_file', 'delete_file', 'run_command'];
export const ALL_TOOLS = Object.keys(DECLARATIONS);

/** Function declarations for the tools a runner supports. */
export function declarationsFor(capabilities) {
  const caps = Array.isArray(capabilities) && capabilities.length ? new Set(capabilities) : new Set(BASE_TOOLS);
  const out = [];
  for (const key of ALL_TOOLS) {
    if (!caps.has(key)) continue;
    if (key === 'read_file' && caps.has('read_file_lines')) continue; // the ranged version replaces it
    out.push(DECLARATIONS[key]);
  }
  return out;
}

/** Back-compat export: the base tool set. */
export const TOOL_DECLARATIONS = declarationsFor(BASE_TOOLS);

/** Tools that only read: always safe, never need approval. */
const READ_ONLY = new Set(['list_dir', 'list_tree', 'search_files', 'read_file']);

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
  if (name === 'write_file' || name === 'edit_file') return { risky: false, reason: '' };
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
    case 'list_tree':
      return `Scan tree: ${args?.path ?? '.'}`;
    case 'search_files':
      return `Search: “${args?.query}”${args?.glob ? ` in ${args.glob}` : ''}`;
    case 'edit_file':
      return `Edit file: ${args?.path}`;
    case 'read_file':
      return `Read file: ${args?.path}${args?.start_line ? ` (lines ${args.start_line}-${args.end_line ?? 'end'})` : ''}`;
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
