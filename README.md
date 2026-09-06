# HyperCut

설정한 음량 이하가 일정 시간 이어지는 구간을 찾아, 영상과 음성을 함께 편집하는 로컬 데스크톱·브라우저 앱입니다.

## 실행

Node.js 22.12 이상과 FFmpeg/ffprobe가 필요합니다. 현재 macOS Apple Silicon에서 개발·검증 중입니다.

```sh
brew install ffmpeg
npm install
npm run build
npm start
```

브라우저에서 `http://127.0.0.1:4327`을 엽니다. 서버는 이 컴퓨터에서만 접속할 수 있고 영상 처리는 로컬에서 실행됩니다.

데스크톱 창으로 실행:

```sh
npm run desktop
```

전사 엔진·한국어 지원 모델 준비 및 Mac 앱 패키지 생성:

```sh
npm run setup:transcription
npm run package:desktop
```

전사 준비는 Apple Silicon macOS의 Python 3와 Xcode Command Line Tools를 사용합니다. 고정 버전 whisper.cpp를 프로젝트 내부에서 빌드하고 공개 Whisper small 모델 약 488MB를 다운로드합니다. 모델을 준비한 후에는 전사에 네트워크·계정·API 호출이 필요하지 않습니다. 모델·도구는 `.hypercut/` 아래에 두고 Git에 포함하지 않습니다.

패키지는 `release/` 아래에 생성됩니다. 현재 약 937MiB이며 전사 실행 파일·모델·한글 글꼴·자막 렌더러·라이선스를 포함합니다. 현재 패키지는 이 컴퓨터에 설치한 FFmpeg/ffprobe를 사용합니다. 다른 컴퓨터로 배포할 때도 해당 도구가 필요합니다. `FFMPEG_PATH`, `FFPROBE_PATH`로 실행 경로를 지정할 수 있습니다.

개발 중에는 `npm run dev`로 서버와 Vite를 함께 시작하고 `http://127.0.0.1:5173`을 사용합니다.

## 편집 흐름

1. H.264 SDR MP4·MOV 영상을 불러옵니다. 화면의 샘플 버튼으로 실제 16초 합성 신호 영상을 체험할 수도 있습니다.
2. 마이크 오디오 트랙을 선택하고 음량 기준, 최소 무음 길이, 말 앞뒤 여유를 설정합니다. 작은 발화를 더 보존하려면 **말소리 보호**를 켭니다.
3. **무음 분석하기**로 컷 초안을 만듭니다. 원본은 바뀌지 않습니다.
4. 구간을 선택해 들어보고 필요한 컷은 복원합니다. **일부 구간 복원**으로 원본 시간 범위를 지정할 수 있습니다. 타임라인 확대·축소, 실행 취소·다시 실행을 지원합니다. 선택한 컷은 R로 복원/제거합니다.
5. **정확한 미리보기**는 실제 인코딩한 편집본을 만듭니다. 빠른 컷 미리보기의 탐색 지연과 구분합니다.
   컷 경계만 확인하려면 타임라인에서 컷을 선택한 뒤 **선택 컷 미리보기**를 누릅니다. 앞뒤 2초가 기본값이며 범위를 바꿀 수 있습니다. 짧은 미리보기는 별도 창에서 재생합니다.
6. MP4 내보내기 후 **편집한 MP4 저장**을 누릅니다. 결과물은 길이·트랙·전체 디코딩 검증 후 제공됩니다.
7. 프로젝트 JSON에는 원본의 SHA-256과 편집 정보를 저장합니다. 다음에 열 때 같은 원본 파일을 다시 선택합니다. Mac 저장 중 추가 편집은 미저장 상태로 유지하며, 이전 프로젝트의 저장 완료는 따로 안내합니다. 늦게 읽힌 파일이 새 선택이나 이후 편집을 덮어쓰지 않습니다.

## 동작과 현재 범위

- 기본 음량 기준은 dBFS, 샘플별 모든 채널의 절댓값을 비교합니다. 작은 목소리도 제거될 수 있습니다.
- 선택형 **말소리 보호**는 번들 Silero VAD 모델을 로컬 CPU에서 실행하고, 말소리로 감지한 구간을 삭제 후보에서 제외합니다. 음성 감지 기준은 음량 임계값과 다르며 낮출수록 더 많은 구간을 보존합니다. 감지된 구간으로 이동해 직접 들어볼 수 있습니다. 음성 전사나 모든 발음 보존을 보장하는 기능은 아닙니다.
- 보호 분석은 각 채널을 별도로 처리합니다. 분석 입력에만 최대 100배의 음량 정규화를 적용하며 출력 음량은 바꾸지 않습니다. 분석 시간이 추가되며, 큰 잡음이 섞인 작은 발화 등에서는 놓치는 구간이 있을 수 있습니다.
- 영상 프레임 안쪽으로 경계를 정렬하고, 같은 유지 구간에서 오디오 샘플을 추출합니다. 오디오는 마지막에 한 번만 AAC로 인코딩합니다.
- 선택한 오디오 트랙 하나를 출력합니다. HDR·HEVC는 아직 지원하지 않습니다.
- 브라우저가 사용하는 로컬 작업 파일은 `.hypercut/sessions/`에 있습니다. 데스크톱 앱은 앱 사용자 데이터 폴더를 사용합니다. 자동 삭제하지 않으므로 필요한 출력물을 저장한 뒤 종료 상태에서 정리할 수 있습니다.
- 로컬 전사·자막 문구/시각 수정·SRT 저장·자막 디자인의 MP4 합성 및 AI 교정 제안의 비교·선택 적용을 사용할 수 있습니다. 로컬 효과음 배치·길이·음량·음소거·저장·MP4 합성 및 AI 효과음 제안의 비교·선택 적용도 제공합니다. 실제 모델의 교정·배치 품질과 한국어 영상의 품질·시간 절감 평가는 후속 작업입니다. 아래 계획의 전체 통과를 아직 주장하지 않습니다.

VAD 모델(약 2.3MB)과 라이선스는 `assets/models/`에 포함됩니다. 추론 중 모델 다운로드나 AI 계정은 필요하지 않습니다. ONNX Runtime의 원격 진단은 로드 전에 끕니다. 프로젝트는 자막·디자인·효과음·교정 용어·끝 경계 검토 정보를 저장하는 v7로 생성합니다. 기존 v1은 보호 꺼짐·자막 없음, v2는 기존 보호 설정·자막 없음, v3는 기존 자막을 보존해 읽습니다. v1~v3를 열 때 MP4 자막 포함은 꺼져 있습니다. v4는 기존 스타일을 보존하며 v1~v4의 효과음은 빈 상태로 읽습니다. v1~v5의 교정 용어는 빈 상태로 읽습니다. v6의 기존 용어도 보존합니다. 이전 HyperCut 버전은 v7 프로젝트를 열지 못할 수 있습니다.

## 로컬 전사와 자막

영상 선택 후 **자막**을 열어 언어·전사 채널을 고르고 **음성 전사 시작**을 누릅니다. 현재 한국어·영어·언어 자동 감지를 선택할 수 있습니다. 실제 검증 자료는 한국어 TTS이며 일반 녹음 정확도나 다른 언어 품질까지 검증한 것은 아닙니다.

- 원본 재생으로 문구와 시각을 확인하고 **자막 수정 적용**을 누릅니다. 적용하지 않은 입력을 닫거나 다른 자막으로 이동할 때는 확인을 받습니다.
- 자막 자체의 삭제·실행 취소·다시 실행을 지원합니다. 수정 결과는 프로젝트에 포함됩니다.
- **이 자막 AI 교정** 또는 **현재부터 N개 AI 교정**은 최대 20개·4,000자 범위에서 선택한 AI에 요청하거나 채팅 응답을 가져옵니다. 원문·제안·이유를 비교하고 필요한 변경만 선택합니다. 숫자 변경은 거부하며 부정 표현 변화는 확인을 요구합니다. 프로젝트에 저장한 용어를 기본으로 사용하며 이번 요청에서만 바꾸거나 비울 수 있습니다. [교정 실행 기록](docs/testing/2026-09-05-caption-correction-results.md)에 모의 검증과 실제 모델 미검증을 구분했습니다.
- **프로젝트 교정 용어**에 앱 이름·전문 용어를 2,000자 이내로 입력하고 **프로젝트 용어 적용**을 누릅니다. 자막의 실행 취소·다시 실행과 프로젝트 저장에 포함됩니다. AI 교정 창의 임시 변경은 프로젝트 용어를 덮어쓰지 않습니다. 용어 적용만으로 전사·자막을 자동 치환하거나 모델을 호출하지 않습니다. [용어 저장 검증](docs/testing/2026-09-05-project-glossary-results.md)에 이전 프로젝트·두 앱의 저장/복구 근거를 기록했습니다.
- 전사 결과가 영상 끝을 조금 넘으면 마지막 창 안의 구간만 원본 끝으로 맞추고 **영상 끝 검토 필요**로 표시합니다. **다음 검토 자막으로 이동**으로 원본을 듣고 문구·끝 시각을 확인한 뒤 **문구와 영상 끝 확인 완료**를 누릅니다. 검토 전에는 해당 자막의 SRT·자막 포함 MP4 출력을 막습니다. 큰 시각 오류는 계속 거부합니다. [끝 경계 오류 수정 기록](docs/testing/2026-09-05-transcription-end-results.md)에 실제 60분 재현과 두 앱 검증을 남겼습니다.
- 컷이 문장 일부를 가로지르면 삭제된 말이 남아 있지 않은지 검토합니다. 검토는 해당 문구·원본 시각·유지 구간에만 유효하며 새 컷이나 수정 후에는 다시 확인합니다.
- **편집한 SRT 저장**은 실제 영상 출력과 같은 프레임 경계로 편집 시간축을 계산합니다. 삭제된 구간의 자막은 제외하며 컷 복원 시 다시 나타납니다.
- **자막 디자인**에서 기본형·배경 박스·강조형, 크기·위치·여백을 고릅니다. **MP4에 포함**을 켜고 **영상에 합성해 미리보기**로 확인한 뒤 내보냅니다. 스타일도 실행 취소·다시 실행·프로젝트 저장에 포함됩니다.
- 긴 문구는 최대 3줄로 맞추며 필요한 경우 글자를 줄입니다. 지원하지 않는 문자나 너무 긴 문구는 수정 안내를 표시합니다. 한글 글꼴 누락·손상·렌더 실패를 자막 포함 출력 성공으로 표시하지 않습니다.
- SRT에는 문구·시각만 담습니다. 영상에 디자인을 보존하려면 자막 포함 MP4로 저장합니다. 컷·자막·스타일을 바꾸면 이전 미리보기와 내보내기 결과는 해제됩니다.
- Whisper small의 첫 실제 샘플에는 ‘무음 → 부분’ 오인식과 부정확한 문장 시각이 있었습니다. 자동 전사 결과를 검토 없이 확정하지 않으며, 이 결과를 음성 인식 품질 통과로 표시하지 않습니다.

엔진·모델이 없으면 무음 편집은 계속 사용할 수 있습니다. 전사 실패 시 다른 모델이나 클라우드로 자동 전환하지 않습니다. 개발 환경의 전사 위치는 `.hypercut/transcription/`, 패키지는 앱의 `Resources/transcription/`이며 테스트 환경에서는 `HYPERCUT_TRANSCRIPTION_DIR`로 지정할 수 있습니다. [모델 명세](assets/models/whisper-small.json)와 [실행 기록](docs/testing/2026-09-05-transcription-results.md)을 참고하세요.

자막은 번들 Noto Sans KR 글꼴과 `@napi-rs/canvas`로 투명 이미지를 만들고 FFmpeg `overlay`로 합성합니다. FFmpeg의 `subtitles`/libass 필터는 필요하지 않습니다. 폰트 출처·해시는 [글꼴 명세](assets/fonts/manifest.json), SIL OFL 라이선스는 [OFL.txt](assets/fonts/OFL.txt), 실제 프레임·두 앱·오프라인 근거는 [자막 디자인 검증](docs/testing/2026-09-05-caption-rendering-results.md)에 있습니다. 사용자 컴퓨터의 다른 글꼴은 읽지 않습니다.

## 로컬 효과음

영상 선택 후 **효과음** 창에서 로컬 음원을 추가합니다. 원본 배치 시각·음원 내부 시작·길이·음량·음소거를 수정하고 적용합니다. 실행 취소·다시 실행·클립 삭제를 지원합니다. 기본 음량은 -12 dB이며 효과음 파일은 모노·스테레오, 5분·1 GB 이하를 지원합니다.

- 시작점이 컷에서 삭제되면 효과음도 출력에서 빠집니다. 컷을 복원하면 원래 배치로 돌아옵니다.
- **효과음 포함 미리보기**와 MP4에 실제 합성합니다. 빠른 컷 미리보기에는 효과음이 포함되지 않습니다.
- 프로젝트에 음원 SHA-256과 편집값을 저장합니다. 원본 영상과 효과음 파일을 함께 보관하고, 다시 열 때 필요한 음원을 재연결합니다. 다른 파일의 연결은 거부합니다.
- 음원이 없으면 다시 연결하거나 **음원과 클립 제외**/음소거를 선택할 수 있습니다. 이미 연결한 파일이 이동했을 때도 같은 창에서 다시 연결할 수 있습니다.
- 겹친 소리의 합성 또는 최종 AAC에서 0 dBFS 초과 샘플이 있으면 출력하지 않고 음량 조정을 안내합니다. 자동 정규화나 리미터는 적용하지 않습니다.
- **AI 효과음 제안**에서 사용할 음원·수정할 기존 클립·참고 자막을 선택하고 지시를 입력합니다. 음원은 별칭·직접 적은 설명·길이로 전달하며 실제 소리를 보내지 않습니다. 자막은 선택 사항입니다.
- 추가·수정·삭제 제안을 현재 값과 비교해 필요한 항목만 적용합니다. 영상·트랙·컷·효과음·자막이 변경되면 이전 제안은 적용할 수 없습니다. 적용 결과는 한 번에 실행 취소하고 프로젝트에 저장할 수 있습니다.
- [효과음 실행 기록](docs/testing/2026-09-05-effects-results.md)과 [AI 제안 실행 기록](docs/testing/2026-09-05-ai-effects-results.md)에 실제 두 앱·오디오 수치·모의 응답·실제 모델 미검증을 구분했습니다.

## 선택형 AI 도움

AI 메뉴에서 자연어로 무음 설정을 제안받고 현재 값과 비교해 적용합니다. 이 작업은 요청 문장과 네 가지 설정만 전달하며 적용 후 다시 분석해야 컷이 바뀝니다. 자막 창의 AI 교정은 선택한 문구·용어·교정 지시만 전달합니다. 효과음 제안은 선택한 음원의 별칭·설명, 클립·참고 자막의 원본 시각과 영상 유지 구간을 전달합니다. 세 작업 모두 원본 영상·음성·파일명을 자동 첨부하지 않습니다.

- **Ollama**: 이 컴퓨터의 HTTP 서버와 설치한 모델 이름을 지정합니다. 원격 주소는 허용하지 않습니다.
- **Claude Code — 기존 구독 로그인**: 설치된 Claude Code의 구독 로그인을 확인하고 선택한 모델에 설정 제안을 요청합니다. 설치·로그인 확인에는 모델 요청을 보내지 않습니다. 로그인은 터미널의 `claude auth login`을 사용하며, HyperCut은 로그인 정보를 프로젝트에 저장하지 않습니다. 제안 요청 시 해당 계정의 사용량이 적용됩니다. 실제 인증된 모델 응답은 아직 미검증인 실험 연결입니다.
- **OpenAI API / Claude API**: 사용 가능한 모델 ID와 별도 API 키를 직접 지정합니다. 키는 서버 메모리에만 보관하고 앱 종료·연결 해제 시 버립니다. 연결 설정 저장은 네트워크 호출이 아니며, 제안 요청 버튼을 눌렀을 때만 해당 공급자를 호출합니다. 다른 공급자로 자동 전환하지 않습니다.
- **기존 ChatGPT·Claude 채팅에서 수동 사용**: 요청 복사→사용하는 채팅에 붙여넣기→JSON 응답 가져오기 방식입니다. 채팅에서 HyperCut을 호출하는 MCP 연결은 아직 구현하지 않았습니다.

세 API는 모의 공급자로, Claude Code는 모의 실행 파일을 통한 실제 프로세스·API·브라우저·Mac 앱 흐름으로 검증했습니다. 설치된 실제 CLI의 로그인 상태도 확인했으나 인증된 모델 요청과 응답 품질은 아직 검증하지 않았습니다. 채팅 구독이 API 사용료까지 포함한다고 가정하지 않습니다. 응답은 허용된 설정·수치 범위로 재검증합니다. CLI는 모델의 파일·셸·MCP 도구를 끄고 요청문을 표준 입력으로 전달합니다. CLI의 관리자 정책은 계속 적용됩니다.

설정 저장, 로그인 확인, 실제 AI 응답 성공을 별도로 표시합니다. Claude Code 연결에서 API 키 인증이나 다른 모델 공급자로 자동 전환하지 않습니다. 설치 경로를 자동으로 찾지 못할 때는 앱을 시작하는 환경의 `CLAUDE_CLI_PATH`로 지정할 수 있습니다.

구독 CLI 동작과 사용량 근거: [Claude Code CLI 옵션](https://code.claude.com/docs/en/cli-reference), [Claude 구독의 SDK/CLI 사용 안내](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). 공급자 정책과 설치 버전에 따라 가용성이 달라질 수 있습니다.

공식 연결 계약: [Ollama Chat](https://docs.ollama.com/api/chat), [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## 검증

계획·통과 기준·실제 결과·미실행 범위는 [검증 안내](docs/testing/README.md)에 모았습니다. [말소리 보호 검증](docs/testing/2026-09-05-speech-protection-results.md)과 [Claude Code 연결 검증](docs/testing/2026-09-05-claude-cli-results.md)을 따로 기록했습니다. 현재 정식 MVP 전체 검증이 완료된 상태는 아닙니다.

```sh
npm test
npm run test:media
npm run test:speech
npm run test:api
npm run test:claude
npm run test:failures
npm run test:save:crash
npm run test:project:io
npm run test:jobs:races
npm run test:benchmark:selection
npm run build
npm run test:e2e -- --desktop --packaged
npm run test:claude:e2e -- --desktop
npm run test:speech:e2e -- --desktop
npm run test:speech:offline
npm run test:transcription
npm run test:transcription:end:e2e -- --desktop
npm run benchmark:transcription
npm run test:captions
npm run test:captions:e2e -- --desktop
npm run test:captions:offline
npm run test:correction
npm run test:correction:e2e -- --desktop
npm run test:glossary:e2e -- --desktop
npm run test:effects
npm run test:effects:e2e -- --desktop
npm run test:ai-effects
npm run test:ai-effects:e2e -- --desktop
```

E2E에는 설치한 Chrome과 먼저 생성한 Mac 앱 패키지가 필요합니다. `npm run benchmark`는 긴 합성 영상을 만들고 10분·60분 조건을 각 3회 처리합니다. 단위 검증과 실제 FFmpeg 입출력 검증을 구분합니다. 자세한 요구와 실행 계획은 [검증 계획](docs/plans/2026-09-05-validation-plan.md), [테스트 계획](docs/plans/2026-09-05-test-plan.md), [구현 계획](docs/plans/2026-09-05-implementation-plan.md)에 있습니다.

한국어 VAD 시험은 macOS에 설치된 `Eddy (Korean (South Korea))` TTS 음성을 사용합니다. TTS 자료는 제품 배포에 포함하지 않으며 사용자 영상 품질 평가를 대신하지 않습니다. 외부 연결을 차단한 OS 시험은 현재 브라우저 모드에서 수행합니다. 모델 출처와 해시는 [모델 명세](assets/models/silero-vad.json), 조건은 [VAD 계획](docs/plans/2026-09-05-speech-protection-plan.md)을 참고하세요.

`npm run benchmark:transcription`은 10분·60분의 반복 한국어 TTS 자료를 두 앱에서 각각 3회 실제 전사합니다. 앱/모델 프로세스 트리의 RSS와 자막 선택 반응·취소를 측정하며 CPU를 사용합니다. 60초 예비 확인은 `npm run benchmark:transcription -- --durations=60 --iterations=1 --output=test-output/transcription-performance-smoke`로 실행합니다. OS 캐시를 비우지 않으며 실제 녹음 품질 시험을 대체하지 않습니다. [측정 계획](docs/plans/2026-09-05-transcription-performance-plan.md)과 [실행 기록](docs/testing/2026-09-05-transcription-performance-results.md)에 범위와 결과를 구분합니다.

전사 성능 측정은 기존 결과를 덮어쓰지 않습니다. 같은 조건을 다시 실행할 때는 `--output=test-output/새-측정-이름`으로 새 폴더를 지정하세요.

`npm run test:jobs:races`는 두 앱에서 34개 경합 조건을 검사합니다. 실제 전사와 효과음 합성을 포함하므로 로컬 Whisper 모델, Mac 패키지, 한국어 Eddy TTS와 FFmpeg가 필요합니다. `--scenarios=CURRENT_CANCEL_ERROR_TRANSCRIBE,CURRENT_CANCEL_ERROR_CAPTIONS`로 자막 창 취소 재시도 조건만 선택할 수 있습니다. [편집창별 실행 기록](docs/testing/2026-09-05-editor-job-race-results.md)에 범위와 재현 방법을 정리했습니다.

`node scripts/effect-import-project-race-e2e.mjs --output=test-output/새-시험-이름`은 효과음 추가·재연결·취소와 이전 프로젝트 파일 읽기가 겹치는 8조건을 두 앱에서 검사합니다. 브라우저 빌드·Mac 패키지·Chrome·FFmpeg가 필요하며, 생성 파일의 실제 저장 내용과 합성을 확인합니다. [경합 실행 기록](docs/testing/2026-09-05-effect-import-project-race-results.md)에 수정 전·후 결과와 시험 중계의 범위를 정리했습니다.

`node scripts/vad-benchmark.mjs --output=test-output/새-시험-이름`은 말소리 보호를 켠 10분·60분 영상을 두 앱에서 각 3회 측정합니다. 현재 [실행 기록](docs/testing/2026-09-06-vad-performance-results.md)은 시간·조작·취소 기준을 충족했지만 브라우저 메모리가 2GiB를 초과한 결과입니다. 실제 녹음 품질이나 전체 성능 통과를 뜻하지 않습니다.
