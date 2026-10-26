# Tafsiri

Free live translation for online meetings, as a Chrome extension. Tafsiri hears the meeting tab, writes down what
each person says in the language they speak, and shows it translated in a small floating window you can drag
anywhere, resize, shrink to a slim bar, or pop out so it stays on top while you share your screen. No captions
needed. Everything runs on your own computer with Chrome's built-in AI and translator: no server, no API key, no cost.

Works in Chrome on desktop, version 138 or newer, for meetings opened in the browser: Google Meet, Microsoft Teams
on the web, Zoom on the web. It does not work with the Zoom or Teams desktop apps.

## Two ways it gets the speech

- **Hear audio** (default where available): captures the meeting tab's sound. Needs Gemini Nano, the AI model
  built into Chrome, which runs on computers with enough memory and disk (tested on a MacBook in
  October 2026). Detects the spoken language by itself. Subtitles trail speech by about 5 to 8 seconds.
- **Read captions**: reads the meeting's own captions (turn on CC in the call). For computers without Gemini Nano.

## Languages

Hear audio understands English, Spanish, German, French and Japanese speech: those are the spoken languages
Gemini Nano accepts in Chrome 155 (checked 2026-10-26).

Translation goes into any language Chrome's translator has (fast, good quality). On 2026-10-12 that was: Arabic,
Bengali, Bulgarian, Chinese (Simplified and Traditional), Croatian, Czech, Danish, Dutch, English, Finnish, French,
German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Kannada, Korean, Lithuanian, Marathi,
Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Tamil, Telugu, Thai,
Turkish, Ukrainian, Vietnamese.

Swahili, Kinyarwanda, Amharic and other African languages: Chrome 154 let Gemini Nano translate them; Chrome 155
refuses, and Chrome's translator does not have them. Tafsiri offers them again by itself on any Chrome that
allows them.

## Install

From the Chrome Web Store:
https://chromewebstore.google.com/detail/tafsiri-live-meeting-tran/jabmecmcfkdnnkkiehnfokifbbfbbkbd

Or unpacked, for development:

1. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder (or the unzipped release).
3. Pin the Tafsiri icon from the puzzle-piece menu.

## Use

1. Join the meeting in Chrome. A slim Tafsiri bar appears in the top right corner.
2. Click the Tafsiri icon in the toolbar (or press Alt+Shift+T). Chrome only lets an extension hear a tab after
   this click, once per tab.
3. Pick the language to translate into and press **Start translating**.

The translation is the big line. The speaker's own words appear under it, small and grey with a language tag,
while the translation is on its way; after that, tap a line to see them again, or tick Original to keep them for
every line. While nothing is written yet, the window says how many bits of speech it heard, so you can tell
"nobody spoke" from "something is wrong". A and A change the text size, Copy copies the conversation, Clear empties it.

## How it works

- `background.js`: the toolbar icon, tab audio capture (`tabCapture`), the offscreen listener's lifecycle, and
  relaying lines to the right tab.
- `offscreen.html` / `offscreen.js` + `lib/listener.js`: holds the tab's sound, plays it back so you still hear
  the meeting, cuts it at pauses (`lib/segmenter.js`, `audio-worklet.js`) and asks Gemini Nano what was said, in
  which language, and (for languages Chrome's translator lacks) the translation.
- `captions.js` + `lib/tracker.js`: the caption reader, for Read captions mode.
- `overlay.js` + `overlay-css.js`: the floating window in a shadow root, the subtitle view (`lib/chunks.js`) and
  translation (Chrome's translator first, Gemini Nano for the rest).

## Develop

- Tests: `node --test tests/*.test.mjs`
- Local preview: `python3 -m http.server 8787` in this folder, then open `http://127.0.0.1:8787/dev/meeting.html`
  (Toolbar button opens Tafsiri; Hear audio plays `dev/local/meeting.wav` into the real listener, silently; Read
  captions uses the mock caption speakers). `dev/local/` is not committed: put any short test recording there.
- `dev/store.html?shot=1` stages the store screenshots. Store copy, permission reasons and privacy answers live in
  `CHROMEWEBSTORE.md`; images in `store/`.
- After editing extension files, press reload on the Tafsiri card in `chrome://extensions` and reload the meeting tab.

## Release an update

1. Bump `version` in `extension/manifest.json`.
2. Zip the `extension` folder only: `cd extension && zip -r ../tafsiri-<version>.zip . -x '.*'`.
3. Upload it at https://chrome.google.com/webstore/devconsole (Tafsiri, Package, Upload new package) and submit.
   Store copy, permission reasons and privacy answers live in `CHROMEWEBSTORE.md`.
4. Attach the same zip to a GitHub release tagged `v<version>`.

## Sound

While Tafsiri hears a tab, Chrome routes that tab's sound through Tafsiri, which plays it on your default output. If you picked a
headset inside the meeting app but your computer's default output is the speakers, set the default output to the headset to avoid echo.
