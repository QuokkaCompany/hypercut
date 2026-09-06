# Third-party notices

HyperCut's original code is distributed under [GPL-3.0-only](LICENSE). Third-party components retain their own licenses. This file identifies major bundled assets and runtime components; it does not replace their license texts or the notices shipped with installed dependencies.

| Component | Use | License and source |
| --- | --- | --- |
| Noto Sans KR / Noto Sans CJK KR | Bundled caption fonts | SIL Open Font License 1.1; [local license](assets/fonts/OFL.txt), [manifest](assets/fonts/manifest.json), [Noto CJK](https://github.com/notofonts/noto-cjk) |
| Silero VAD 6.2.1 | Bundled speech-detection model | MIT; [local license](assets/models/LICENSE.silero-vad.txt), [manifest](assets/models/silero-vad.json), [upstream](https://github.com/snakers4/silero-vad) |
| Whisper small multilingual | Downloaded by setup; included in locally built transcription packages | MIT; [local model license](assets/models/WHISPER-MODEL-LICENSE), [manifest](assets/models/whisper-small.json), [Whisper](https://github.com/openai/whisper) |
| whisper.cpp | Built by setup; included in locally built transcription packages | MIT; pinned revision and archive hash in [setup script](scripts/setup-transcription.mjs); [upstream](https://github.com/ggml-org/whisper.cpp) |
| ONNX Runtime | Native VAD inference | MIT; [upstream](https://github.com/microsoft/onnxruntime) and notices in the installed package |
| Electron | Desktop runtime | MIT and included third-party notices; [upstream](https://github.com/electron/electron) |
| FFmpeg / ffprobe | External media processing prerequisites | Not bundled by HyperCut; applicable LGPL/GPL terms depend on the selected build and configuration. See the [FFmpeg legal page](https://ffmpeg.org/legal.html). |

JavaScript and native package versions are recorded in [package-lock.json](package-lock.json). Preserve the license and notice files supplied by those packages when redistributing builds. React, Express, the MCP SDK, canvas/rendering dependencies, and build tools are not relicensed by HyperCut's root license.

The repository does not include the downloaded Whisper model, compiled whisper.cpp runtime, private recordings, or generated application packages. Local packaging adds the prepared transcription resources and their notices. Adding a dependency or redistributing a new binary requires checking that component's actual license and configuration.
