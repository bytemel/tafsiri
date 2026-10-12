# Chrome Web Store Listing: Tafsiri

> Last Updated: 2026-10-12

Copy each field below into the Chrome Web Store Developer Dashboard. Store text is plain (the store strips
Markdown), so paste the description as is.

## Store Listing

**Extension Name**

Tafsiri: live meeting translation

**Short Description** (same as the manifest description, 128 characters; the store limit is 132)

Free live translation for Google Meet, Teams and Zoom on the web. Hears the meeting and shows translated subtitles you can move.

**Detailed Description**

Tafsiri shows live translated subtitles for the online meeting you are in, in a small window you can place anywhere on your screen.

What it does
Hears the meeting tab and writes down what each person says, in the language they speak, then translates it into your language a few seconds later.
Detects the spoken language by itself, so a meeting can switch between English, French, Swahili and more.
Translates into about 50 languages, including Swahili, Amharic, Hausa, Yoruba, Zulu and Somali on computers that support Chrome's built-in AI.
Shows the newest lines large and keeps older lines small, so long speeches stay readable.
Can read the meeting's own captions instead, on computers without Chrome's built-in AI.
The window can be dragged, resized, shrunk to a slim bar, or popped out so it stays on top while you share your screen.
Copy the whole translated conversation with one click.

How to use it
1. Join your meeting in Chrome: Google Meet, or Microsoft Teams and Zoom in the browser.
2. Click the Tafsiri icon in the toolbar (or press Alt+Shift+T). A window opens on the meeting.
3. Pick the language to translate into and press Start translating.
4. The first time, Chrome may download its language tools. The window shows the progress.

Privacy
Everything happens on your own computer. Tafsiri does not send the meeting's sound, words or translations anywhere, has no account, no server and no analytics. It only stores your settings (languages, text size, window position) in Chrome on your computer.

Good to know
Works in Chrome on desktop, version 138 or newer. Hearing the meeting needs a computer that runs Chrome's built-in AI model; on other computers, turn on the meeting's captions and Tafsiri reads those. It does not work with the Zoom or Teams desktop apps; join through the browser.

Questions or problems: timmwangim@gmail.com

**Category**

Communication (in the dashboard: Productivity > Communication)

**Single Purpose**

Shows live translated subtitles of the online meeting open in the current tab.

**Primary Language**

English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128x128 PNG | Ready | `extension/icons/128.png` |
| Screenshot 1 | 1280x800 | Ready | `store/screenshot-1-subtitles.png` |
| Screenshot 2 | 1280x800 | Ready | `store/screenshot-2-setup.png` |
| Small Promo Tile | 440x280 | Ready | `store/promo-small.png` |

### Screenshot Notes

Screenshots show the Tafsiri window over a plain mock meeting page, not a real Google, Microsoft or Zoom
interface, so no third-party logos or trademarks appear.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `tabCapture` | permissions | When the user clicks the Tafsiri icon on a meeting tab, Tafsiri hears that tab's sound so it can write down what people say and translate it. Only the tab the user chose is heard, only while translation is on. The sound is processed on the computer and never sent anywhere. |
| `offscreen` | permissions | Holds the meeting tab's sound while Tafsiri listens, plays it back so the user still hears the meeting, and turns speech into text on the computer. Closed as soon as listening stops. |
| `activeTab` | permissions | The click on the Tafsiri icon is what allows it to hear the current tab, and lets the user open Tafsiri on a meeting site that is not in the list below. |
| `scripting` | permissions | Adds the Tafsiri window to meeting tabs that were already open when the extension was installed or updated, and to the current tab when the user clicks the icon, so nobody has to reload and drop out of a call. |
| `storage` | permissions | Remembers the user's chosen languages, text size and window position on this computer. |
| `https://meet.google.com/*` | host_permissions | Shows the Tafsiri window on Google Meet calls and, when the user chooses, reads the call's on-screen captions. |
| `https://teams.microsoft.com/*`, `https://teams.live.com/*`, `https://teams.cloud.microsoft/*` | host_permissions | Same, for Microsoft Teams calls in the browser (work, personal and new Teams addresses). |
| `https://*.zoom.us/*`, `https://*.zoom.com/*` | host_permissions | Same, for Zoom calls in the browser. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No.

The meeting's sound and captions are handled on the computer only, to show subtitles, and are never stored or
transmitted. Settings stay in `chrome.storage.local` (not sync). There are no network requests from the
extension's code. Recommended dashboard answers: tick no data types, and tick all three certifications.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personal communications | No (handled on device only) | No | Live subtitles | No |
| Website content | No (handled on device only) | No | Reading on-screen captions | No |
| All other types | No | No | - | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**: https://gist.github.com/bytemel/658f63d81a7a6c8838bfbf12b58352ad (stopgap; switch to https://www.timmwangi.com/tafsiri/privacy once Vercel deploys tim.p 49710ba)

Source text: `store/privacy-policy.md`.

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: Timothy Mwangi
**Contact Email**: timmwangim@gmail.com (shown publicly; change it in the dashboard if you prefer another)
**Support URL**: https://www.timmwangi.com/tafsiri/privacy
**Homepage URL**: https://www.timmwangi.com

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.2.0 | 2026-10-12 | Hears the meeting audio (no captions needed) with automatic language detection; Swahili and other languages through Chrome's built-in AI; subtitle view with the newest lines large. | Draft |
| 0.1.0 | 2026-10-12 | First build: reads meeting captions, floating window, picture in picture. Not submitted. | Not submitted |

## Review Notes

### Known Issues / Limitations
- Hearing audio needs Chrome's built-in AI model (Gemini Nano), which runs only on computers with enough memory
  and disk. Elsewhere the extension falls back to reading the meeting's captions.
- Subtitles lag speech by about 5 seconds.
- Chrome asks for one click on the toolbar icon per tab before it allows hearing that tab.

### Rejection History
None yet.
