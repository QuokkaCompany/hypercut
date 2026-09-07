# README showcase assets

These assets show the running HyperCut application on September 7, 2026. They were captured in Chrome on macOS with the self-hosted cloud API, a separate worker, and the installed Whisper small runtime. No UI content, processing result, or project card was mocked.

## Files

| Asset | Content |
| --- | --- |
| [HyperCut icon](../../public/favicon.svg) | The existing lime H application icon, reused in the README. |
| [walkthrough.gif](walkthrough.gif) | A compact, silent recording of import, analysis, cut restoration, caption styling, and the completed workspace. |
| [walkthrough.mp4](walkthrough.mp4) | The same screen recording at 1560 × 1000, without audio. |
| [silence-editing.png](silence-editing.png) | The actual editor viewport after detecting four pauses. |
| [captions.png](captions.png) | A direct capture of the caption workspace element, including source playback, text, cues and style controls. |
| [cloud-workspace.png](cloud-workspace.png) | The actual workspace with one saved project, completed jobs and an export. |
| [edited-tutorial.mp4](edited-tutorial.mp4) | The 1280 × 720, 30 fps captioned result from HyperCut, with its audio track removed for public distribution. |

The screen recording joins four scenes in their original order. Idle processing and intermediate review steps between scenes are omitted; actions within scenes play at their recorded speed. Screenshots are direct browser captures. The account is a disposable `demo@example.com` fixture; authentication happens before recording.

## Original sample and observed result

The capture script draws three original tutorial slides and privately generates English speech with the macOS Samantha voice. Generated speech audio is used only as input to the local demonstration and is not included in any public asset. No customer recording, personal account, private project, or paid AI service is used.

The sample says:

> Start with a short tutorial. Leave a little space between each idea.
>
> Remove the pauses, then review every cut on the timeline.
>
> Create captions from your voice. Fix the wording, choose a style, and export.

With −40 dBFS, a 500 ms minimum pause, and 100/150 ms speech padding, threshold analysis proposed four cuts. The source video timeline was 18.87 seconds (the source container was 18.899 seconds including audio padding), and the exported video was 13.00 seconds. Whisper produced five English cues. The wording matched the sample apart from punctuation; cut crossings were reviewed before export. HyperCut reported five captions burned into the output. The downloaded audio/video export passed full FFmpeg decoding before the public copy's audio was removed.

This demonstrates a working path with a controlled generated sample. It does not measure transcription accuracy on human recordings, real-world time savings, or external hosting performance. The interface is currently Korean; the cloud workspace and project documentation are English.

## Reproduce

Use macOS with the Samantha voice, Chrome, FFmpeg/ffprobe, Node 24+, and the project's installed dependencies. Prepare the app and local transcription runtime:

```sh
npm ci
npm run build
npm run setup:transcription
node scripts/readme-showcase.mjs
```

Run from the repository root. The script creates a temporary cloud data directory, a random temporary password, original slides and speech, then operates the real editor through Playwright. It verifies the expected wording, cut count, shortened output and video decoding. On success it copies only the six public assets into this directory. Temporary source media, credentials and server data are deleted. Detailed measurements and failure screenshots go to ignored `test-output/readme-showcase/`.

Capture timings and recognition can vary across machines. Inspect all regenerated images, replay both silent videos and update the README measurements before committing replacement assets. Do not publish the private source audio or temporary browser storage.

The icon, tutorial artwork and capture script are part of this GPL-3.0-only project. Rendered Noto fonts retain their [SIL Open Font License](../../assets/fonts/OFL.txt); see the repository's [third-party notices](../../THIRD_PARTY_NOTICES.md).
