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

Mac 앱 패키지 생성:

```sh
npm run package:desktop
```

패키지는 `release/` 아래에 생성됩니다. 현재 패키지는 이 컴퓨터에 설치한 FFmpeg/ffprobe를 사용합니다. 다른 컴퓨터로 배포할 때도 해당 도구가 필요합니다. `FFMPEG_PATH`, `FFPROBE_PATH`로 실행 경로를 지정할 수 있습니다.

개발 중에는 `npm run dev`로 서버와 Vite를 함께 시작하고 `http://127.0.0.1:5173`을 사용합니다.

## 편집 흐름

1. H.264 SDR MP4·MOV 영상을 불러옵니다. 화면의 샘플 버튼으로 실제 16초 합성 신호 영상을 체험할 수도 있습니다.
2. 마이크 오디오 트랙을 선택하고 음량 기준, 최소 무음 길이, 말 앞뒤 여유를 설정합니다.
3. **무음 분석하기**로 컷 초안을 만듭니다. 원본은 바뀌지 않습니다.
4. 구간을 선택해 들어보고 필요한 컷은 복원합니다. **일부 구간 복원**으로 원본 시간 범위를 지정할 수 있습니다. 타임라인 확대·축소, 실행 취소·다시 실행을 지원합니다. 선택한 컷은 R로 복원/제거합니다.
5. **정확한 미리보기**는 실제 인코딩한 편집본을 만듭니다. 빠른 컷 미리보기의 탐색 지연과 구분합니다.
   컷 경계만 확인하려면 타임라인에서 컷을 선택한 뒤 **선택 컷 미리보기**를 누릅니다. 앞뒤 2초가 기본값이며 범위를 바꿀 수 있습니다. 짧은 미리보기는 별도 창에서 재생합니다.
6. MP4 내보내기 후 **편집한 MP4 저장**을 누릅니다. 결과물은 길이·트랙·전체 디코딩 검증 후 제공됩니다.
7. 프로젝트 JSON에는 원본의 SHA-256과 편집 정보를 저장합니다. 다음에 열 때 같은 원본 파일을 다시 선택합니다.

## 동작과 현재 범위

- 음량 기준은 dBFS, 샘플별 모든 채널의 절댓값을 비교합니다. 음성 인식·VAD가 아니므로 작은 목소리도 제거될 수 있습니다.
- 영상 프레임 안쪽으로 경계를 정렬하고, 같은 유지 구간에서 오디오 샘플을 추출합니다. 오디오는 마지막에 한 번만 AAC로 인코딩합니다.
- 선택한 오디오 트랙 하나를 출력합니다. HDR·HEVC는 아직 지원하지 않습니다.
- 브라우저가 사용하는 로컬 작업 파일은 `.hypercut/sessions/`에 있습니다. 데스크톱 앱은 앱 사용자 데이터 폴더를 사용합니다. 자동 삭제하지 않으므로 필요한 출력물을 저장한 뒤 종료 상태에서 정리할 수 있습니다.
- 자막·효과음 기능과 실제 한국어 영상의 품질·시간 절감 평가는 후속 작업입니다. 아래 계획의 전체 통과를 아직 주장하지 않습니다.

## 선택형 AI 도움

AI 메뉴에서 자연어로 무음 설정을 제안받고, 현재 값과 비교해 직접 적용합니다. AI는 영상이나 음성을 듣지 않고 요청 문장과 네 가지 설정만 받습니다. 적용 후 다시 분석해야 컷이 바뀝니다.

- **Ollama**: 이 컴퓨터의 HTTP 서버와 설치한 모델 이름을 지정합니다. 원격 주소는 허용하지 않습니다.
- **Claude Code — 기존 구독 로그인**: 설치된 Claude Code의 구독 로그인을 확인하고 선택한 모델에 설정 제안을 요청합니다. 설치·로그인 확인에는 모델 요청을 보내지 않습니다. 로그인은 터미널의 `claude auth login`을 사용하며, HyperCut은 로그인 정보를 프로젝트에 저장하지 않습니다. 제안 요청 시 해당 계정의 사용량이 적용됩니다. 실제 인증된 모델 응답은 아직 미검증인 실험 연결입니다.
- **OpenAI API / Claude API**: 사용 가능한 모델 ID와 별도 API 키를 직접 지정합니다. 키는 서버 메모리에만 보관하고 앱 종료·연결 해제 시 버립니다. 연결 설정 저장은 네트워크 호출이 아니며, 제안 요청 버튼을 눌렀을 때만 해당 공급자를 호출합니다. 다른 공급자로 자동 전환하지 않습니다.
- **기존 ChatGPT·Claude 채팅에서 수동 사용**: 요청 복사→사용하는 채팅에 붙여넣기→JSON 응답 가져오기 방식입니다. 채팅에서 HyperCut을 호출하는 MCP 연결은 아직 구현하지 않았습니다.

세 API는 모의 공급자로, Claude Code는 모의 실행 파일을 통한 실제 프로세스·API·브라우저·Mac 앱 흐름으로 검증했습니다. 설치된 실제 CLI의 로그인 상태도 확인했으나 인증된 모델 요청과 응답 품질은 아직 검증하지 않았습니다. 채팅 구독이 API 사용료까지 포함한다고 가정하지 않습니다. 응답은 허용된 설정·수치 범위로 재검증합니다. CLI는 모델의 파일·셸·MCP 도구를 끄고 요청문을 표준 입력으로 전달합니다. CLI의 관리자 정책은 계속 적용됩니다.

설정 저장, 로그인 확인, 실제 AI 응답 성공을 별도로 표시합니다. Claude Code 연결에서 API 키 인증이나 다른 모델 공급자로 자동 전환하지 않습니다. 설치 경로를 자동으로 찾지 못할 때는 앱을 시작하는 환경의 `CLAUDE_CLI_PATH`로 지정할 수 있습니다.

구독 CLI 동작과 사용량 근거: [Claude Code CLI 옵션](https://code.claude.com/docs/en/cli-reference), [Claude 구독의 SDK/CLI 사용 안내](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). 공급자 정책과 설치 버전에 따라 가용성이 달라질 수 있습니다.

공식 연결 계약: [Ollama Chat](https://docs.ollama.com/api/chat), [OpenAI 구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## 검증

계획·통과 기준·실제 결과·미실행 범위는 [검증 안내](docs/testing/README.md)에 모았습니다. 최신 AI 연결 근거는 [Claude Code 연결 검증](docs/testing/2026-09-05-claude-cli-results.md)에 있습니다. 현재 정식 MVP 전체 검증이 완료된 상태는 아닙니다.

```sh
npm test
npm run test:media
npm run test:api
npm run test:claude
npm run test:failures
npm run build
npm run test:e2e -- --desktop --packaged
npm run test:claude:e2e -- --desktop
```

E2E에는 설치한 Chrome과 먼저 생성한 Mac 앱 패키지가 필요합니다. `npm run benchmark`는 긴 합성 영상을 만들고 10분·60분 조건을 각 3회 처리합니다. 단위 검증과 실제 FFmpeg 입출력 검증을 구분합니다. 자세한 요구와 실행 계획은 [검증 계획](docs/plans/2026-09-05-validation-plan.md), [테스트 계획](docs/plans/2026-09-05-test-plan.md), [구현 계획](docs/plans/2026-09-05-implementation-plan.md)에 있습니다.
