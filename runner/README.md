# Agent Office — PC runner

Lets an agent in the office work on files on this computer, inside one folder
you choose. It makes an outbound connection to the server, so you do not need
to open any ports or have a public IP.

## What it can do

Inside the work folder only:
- list folders and read files
- create and overwrite files
- move files to the Recycle Bin (never a permanent delete)
- run commands (build, test, git, python, …)

Safe actions (reading, writing, common build/test/git commands) run on their
own. Risky actions (deleting, network commands, anything unusual) pause and
ask you to Approve or Deny in the browser. The runner refuses any path outside
the work folder, whatever the agent asks.

## Setup (Windows)

1. Install Node.js 18+ from https://nodejs.org if you don't have it.
2. Make a work folder, e.g. `C:\AgentWork`. Put only things you're happy for an
   agent to change there.
3. Copy `runner.config.example.json` to `runner.config.json` and fill it in:
   - `SERVER_URL` — your office address, e.g. `https://office.snapeld.com`
   - `RUNNER_TOKEN` — must match `RUNNER_TOKEN` set on the server
   - `WORK_DIR` — the folder from step 2 (use `\\` in the path)
   - `BASIC_AUTH` — `user:password` if the site asks for a login
4. Double-click `start-runner.bat` (or run `node runner.mjs`).

When it says "connected", open the office, start a task, and pick this PC under
**Run on**.

## Stopping it

Close the window, or press Ctrl+C. Nothing runs when it's closed.
