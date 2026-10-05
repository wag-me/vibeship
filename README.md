<p align="center">
  <img src="web/icons/logo.svg" alt="Vibeship: your agents, in orbit" width="560">
</p>

A **3D spaceship** where your [Claude Code](https://claude.com/claude-code) agents work in crew uniforms.
It is a Claude Code *mod* (plugin): every session becomes a little animal that walks, sits at the console, thinks, sleeps and cheers while it really works.

## What it does
- **See what your agents are doing**: they read, write, run commands, search the web. Each agent has a species (fox, cat, dog, raccoon, rabbit, bear, bird) and a uniform (captain, engineer, pilot, scientist, medic, explorer, cadet).
- **Three locations** (Bridge, Engine room, Greenhouse), each with its own agents. Move an agent from its card or by dragging it onto a location's tab (in edit mode).
- **Chat with your agents** from the window: see the conversation, the state of each message and the reply. You can stop or close an agent.
  - Type **`/`** to run slash commands and skills, with suggestions as you type (`/compact`, `/cost`, `/model sonnet`, ...). They run in that session as if typed in the terminal and their output comes back in the chat. A bare `/model` shows a model chooser in the window.
- **Permissions**: when Claude asks for confirmation, the ship goes on alert and you approve or deny from the window (if you don't answer within ~30 s the question falls back to the terminal). For tools that cannot run commands or change files there is also **Allow all session**, so the same question stops coming back.
- **Subagents**: a drone leaves the main agent and lands on the launch pad, where the subagent materializes. While its task runs it roams the room: it sits on free sofas and armchairs, goes to look at objects, or takes a stroll. When the task is done it returns with the result.
- **New agents**: from the *Agent* button pick location, character, uniform and folder (even a **new project**, with optional `git init`) and a terminal with Claude Code opens. Select a work station and press *Add an agent at this station* to have the new agent sit there.
- **Statistics**: the 📊 button shows tokens in/out, sessions, replies, tool usage and the busiest projects and models, over 7, 14 or 30 days (read from Claude Code's own transcripts).
- **Edit mode** (✏️): furniture can be moved, rotated, added and removed only while it is on, so nothing moves by accident when you just want to look around. Furniture catalog with 3D previews, ship lights (normal, red alert, dimmed).

## Controls
| Input | Does |
| :- | :- |
| Click | select an agent or furniture |
| Drag on empty space (or on anything, outside edit mode) | move the view |
| Right click + drag | rotate the view |
| Wheel | zoom |
| `W` `A` `S` `D` / arrows | move the view |
| ✏️ Edit, then drag | move furniture and agents |
| `R` / `Del` (edit mode) | rotate / remove the selected furniture |

## Requirements
- Claude Code **2.1.287 or later** (mods do not exist in earlier versions)
- Node.js
- A browser with WebGL (Edge, Chrome, Firefox). Windows is the tested platform; macOS is written but untested.

## Install
Inside Claude Code (any terminal, any project):
```
/plugin marketplace add wag-me/vibeship
/plugin install vibeship@vibeship
```
Restart Claude Code, then type `/vibeship` in any session. Update later with `/plugin marketplace update vibeship`.

Prefer not to install? Load it for one session from a clone of this repo:
```bash
claude --plugin-dir /path/to/vibeship
```

## Usage
| Command | What it does |
| :- | :- |
| `/vibeship` | starts the local server and opens the 3D window |

Sessions started after the window is open appear in it by themselves; for one that was already running, type `/vibeship` in it.

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
- Chat, slash commands, stop, close, permissions, moves, new agents, statistics and folder creation require a random **token**, saved in a file in your user folder and passed only to the window opened by `/vibeship`.
- The mod is **not sandboxed**: it has the same access as Claude Code. The *Agent* button can open a terminal with Claude Code in a folder you choose, and the chat can run any slash command of the session. Only install mods from sources you trust.
- Statistics are read locally from `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`); nothing leaves your machine.

## Structure
```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   makes this repo installable with /plugin marketplace add
hooks/register.js                 the mod (events, /vibeship, chat commands, permissions)
server/server.js                  local server (SSE, commands, permissions, agent launch, stats), no dependencies
web/                              the 3D window (Three.js, no build step)
  js/                             scene, characters, furniture, effects, audio
  vendor/three/                   Three.js (MIT)
tests/                            mod tests, server tests, live window check
```

## Development
```bash
claude plugin validate .
claude plugin test .                 # mod tests
node --test tests/server.test.js     # server tests
node tests/ui-smoke.js               # opens the window in headless Edge/Chrome and checks it
```
Reload the window with Ctrl+R: files are served from disk, so changes in `web/` do not need a server restart.

## Licenses
Vibeship is released under the [MIT License](LICENSE). Three.js is included in `web/vendor/three/` under its own MIT license.
