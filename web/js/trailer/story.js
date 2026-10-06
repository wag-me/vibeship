// The beats of the 30-second film, in seconds. Picture (director.js), titles (overlay.js) and sound (score.js) all read
// these, so moving a beat here moves it everywhere. Emotional arc: EMPTY → ALIVE → TALK → BUSY → TENSION → CONTROL → WONDER.
// The person is in the film too: they click their agent, write to it, answer its permission request and read its reply,
// all with the window's own controls.
export const FPS = 30
export const DURATION = 30
export const FRAMES = FPS * DURATION

export const T = {
  // 0–3 the hook: a terminal, a command, one line of copy
  typeClaude: 0.45, enterClaude: 0.98, typeSlash: 1.22, enterSlash: 1.8,
  headline: 1.95, headlineOut: 3.9,
  // 3–7 the reveal: the command opens a window onto a little ship in space
  reveal: 3.0, furniture: 3.55, lightsOn: 4.1,
  // 6–10 meet your agent (it enters at 6.0, walks, sits)
  foxIn: 6.0, foxRead: 6.1, capCrew: 6.5,
  // 9.5–13.3 talk to it: click the fox, its card opens, write a message, it gets to work
  cursorFox: 9.45, clickFox: 10.05, typeMsg: 10.5, sendMsg: 12.0, msgSent: 12.25, foxWrite: 12.6, cardOut: 13.0,
  capChat: 10.25,
  // 12–17 the world comes alive
  rabbitIn: 7.6, bearIn: 9.3, dogIn: 12.6, rabbitRun: 13.4,
  sub1: 14.35, sub2: 15.75,
  // 17–22 the "oh" moment: a real permission request, answered from the window
  ask: 17.0, capPerm: 17.55, cursorIn: 18.75, click: 19.9, allow: 19.95, permGone: 21.75,
  // 22–27 the hero shot: open the fox again, the whole window, and its reply lands in the chat
  hero: 22.0, cursorFox2: 21.75, clickFox2: 22.4, capReply: 23.1, subDone: 24.0, foxDone: 24.9,
  // 27–30 the brand
  brand: 27.0, wordmark: 27.65, tagline: 28.25, install: 28.75,
}

// What the person writes to the fox, and what it answers
export const MESSAGE = 'Add rate limiting to /login'
export const REPLY = 'Done ✓ `/login` now allows **5 tries a minute** per IP. Tests pass, pushed to `main`.'
// a human rhythm for the message (seconds after T.typeMsg, one per character)
export const MESSAGE_RHYTHM = MESSAGE.split('').map((_, i) => i * 0.05 + (i % 4 === 3 ? 0.02 : 0) + (i > 13 ? 0.06 : 0))

// The music grid: 120 bpm, bars of 2 s starting at 7 s, so the drop (17 s) and the final chord (27 s) land on bar lines
export const BPM = 120
export const GRID0 = 7
