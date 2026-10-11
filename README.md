# Tafsiri

Free live translation for online meetings, as a Chrome extension. It reads the captions the meeting already shows
and translates them in a small floating window on top of the call. You can drag the window anywhere, resize it,
shrink it to a slim bar, or pop it out into a picture-in-picture window that stays on top of every app.
Translation runs on your own computer with Chrome's built-in translator, so there is no server, no API key and
no cost.

Works in Chrome on desktop, version 138 or newer, for meetings opened in the browser:

- Google Meet
- Microsoft Teams on the web (teams.microsoft.com, teams.live.com, teams.cloud.microsoft)
- Zoom on the web (app.zoom.us web client)
- Other sites that label their captions for screen readers: click the Tafsiri icon on that page

It does not work with the Zoom or Teams desktop apps. Join through the browser instead.

## Install (free, no Web Store)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder inside this project (or inside the unzipped release).
4. Optional: pin the Tafsiri icon from the puzzle-piece menu.

To share it, send someone the release zip and the same steps. Publishing on the Chrome Web Store needs a one-time
$5 developer account; you do not need it to use the extension.

## Use

1. Join the meeting in Chrome. A slim Tafsiri bar appears in the top right corner.
2. Turn on the meeting's captions (the CC button in Meet, More > Captions in Teams, Show captions in Zoom).
3. Click the bar (or the Tafsiri icon, or press Alt+Shift+T) to open it.
4. Pick the spoken language (or Auto detect) and the language to translate into, then press **Start translating**.

The first time you use a language pair, Chrome downloads a small language pack. The window shows the progress.

In the window:

- Drag the title bar to move it. Drag the bottom right corner to resize it. The minimise button shrinks it to a
  slim bar; click the bar to open it again.
- The pop-out button moves it into a picture-in-picture window that floats over everything, handy while you share
  your screen. Close that window (or press the same button) to bring it back.
- A and A change the text size. Original shows or hides the speaker's own words. Copy puts the transcript on the
  clipboard. Clear empties the window.
- The close button hides Tafsiri on that site until you click the icon again.

## Languages

Chrome's on-device translator supported these when checked on 2026-10-12 (Chrome 154): Arabic, Bengali,
Bulgarian, Chinese (Simplified and Traditional), Croatian, Czech, Danish, Dutch, English, Finnish, French, German,
Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Kannada, Korean, Lithuanian, Marathi, Norwegian,
Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Tamil, Telugu, Thai, Turkish,
Ukrainian, Vietnamese.

Not supported then: Swahili, Amharic, Hausa, Yoruba, Igbo, Zulu, Somali, Kinyarwanda, Afrikaans, Persian, Urdu,
Malay, Filipino and a few others. Google may add more; the window says so when a pair is not available.

The spoken languages you can translate from are also limited by what the meeting's own captions support.

## How it works

- `extension/captions.js` finds the meeting's caption area every 400 ms (only while the window is open), splits it
  into speaker turns and passes new or changed lines on. It never touches audio.
- `extension/lib/tracker.js` keeps one stable id per speaker turn, even when the meeting redraws its captions.
- `extension/overlay.js` draws the floating window inside a shadow root (so the meeting's styles cannot touch it)
  and translates each turn sentence by sentence with the `Translator` API. Auto detect uses `LanguageDetector`.
- `extension/background.js` handles the toolbar icon and adds Tafsiri to meetings that were already open when it
  was installed.
- `extension/lib/text.js` holds the pure text helpers.

Meeting platforms change their page code from time to time. When captions stop showing up, the selectors in
`captions.js` need updating.

## Develop

- Tests: `node --test tests/*.test.mjs`
- Local preview without a real meeting: run `python3 -m http.server 8787` in this folder and open
  `http://127.0.0.1:8787/dev/meeting.html`. Use its buttons to open Tafsiri and start the mock speakers. The `dev/`
  folder fakes the few Chrome extension APIs used and is not part of the extension.
- After editing extension files, press the reload icon on the Tafsiri card in `chrome://extensions` and reload
  the meeting tab.
