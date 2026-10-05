<p align="center">
  <img src="web/icons/logo.svg" alt="Vibeship: your agents, in orbit" width="560">
</p>

A **3D spaceship** where your [Claude Code](https://claude.com/claude-code) agents work in crew uniforms.
It is a Claude Code *mod* (plugin): every session becomes a little animal that walks, sits at the console, thinks, sleeps and cheers while it really works.

## What it does
- **See what your agents are doing**: they read, write, run commands, search the web. Each agent has a species (fox, cat, dog, raccoon, rabbit, bear, bird) and a uniform (captain, engineer, pilot, scientist, medic, explorer, cadet).
- **Three locations** (Bridge, Engine room, Greenhouse), each with its own agents. Agents move through the hatch, from their card, or by dragging onto a location's tab.
- **Talk to your agents** from the window: see the conversation, the state of each message and the reply. You can stop or close an agent.
- **Permissions**: when Claude asks for confirmation, the ship goes on alert and you approve or deny from the window (if you don't answer within ~30 s the question falls back to the terminal).
- **Subagents**: a drone leaves the main agent and lands on the launch pad, where the subagent materializes; at the end of the mission it returns with the result.
- **New agents**: from the *Agent* button pick location, character, uniform and folder (even a **new project**, with optional `git init`) and a terminal with Claude Code opens.
- **Statistics**: the 📊 button shows tokens in/out, sessions, replies, tool usage and the busiest projects and models, over 7, 14 or 30 days (read from Claude Code's own transcripts).
- Draggable, rotatable furniture, a catalog with 3D previews, ship lights (normal, red alert, dimmed).

## Requirements
- Claude Code **2.1.287 or later** (mods do not exist in earlier versions)
- Node.js
- A browser with WebGL (Edge, Chrome, Firefox). Windows is the tested platform; macOS is written but untested.

## Usage
```bash
claude --plugin-dir /path/to/vibeship
```
Then, in the session:

| Command | What it does |
| :- | :- |
| `/vibeship` | starts the local server and opens the 3D window |

To have it in every project, in `~/.claude/settings.json`:
```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/vibeship" } }
```

## Environment variables
| Variable | Effect |
| :- | :- |
| `AGENT_OFFICE_PORT` | local server port (default 47890) |
| `AGENT_OFFICE_DIR` | data folder (token, layout); default `~/.claude-agent-office` |
| `AGENT_OFFICE_NAME` | resident's name (default: folder name) |
| `AGENT_OFFICE_LOOK` | look, `species:uniform` (e.g. `fox:3`) |
| `AGENT_OFFICE_LOC` | location: `bridge`, `engine` or `habitat` |

## Security
- The server listens **only on `127.0.0.1`**.
- Chat, stop, close, permissions, moves, new agents, statistics and folder creation require a random **token**, saved in a file in your user folder and passed only to the window opened by `/vibeship`.
- The mod is **not sandboxed**: it has the same access as Claude Code. The *Agent* button can open a terminal with Claude Code in a folder you choose. Only install mods from sources you trust.

## Structure
```
.claude-plugin/plugin.json   manifest
hooks/                        the mod (events and commands)
server/server.js              local server (SSE, commands, permissions, agent launch, stats), no dependencies
web/                          the 3D window (Three.js, no build step)
  js/                         scene, characters, furniture, effects, audio
  vendor/three/               Three.js (MIT)
tests/                        mod tests (`claude plugin test`), server tests (`node --test tests/server.test.js`), live window check (`node tests/ui-smoke.js`)
```

## Development
```bash
claude plugin validate .
claude plugin test .
node --test tests/server.test.js
node tests/ui-smoke.js   # opens the window in headless Edge/Chrome and checks it
```
Reload the window with Ctrl+R: files are served from disk, so changes in `web/` do not need a server restart.

## Licenses
Vibeship is released under the [MIT License](LICENSE). Three.js is included in `web/vendor/three/` under its own MIT license.
