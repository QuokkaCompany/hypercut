# 문장 강조·줌 구현 검증

2026-09-11. 승인된 상세 설계를 구현한 로컬 작업 결과. 경쟁 제품보다 우수하다는 판정이나 배포 승인이 아니다.

## 구현

- 자막에서 문장을 선택하거나 도구 모음의 ‘문장 강조’로 진입한다. 문장별 고대비 자막과 1.00–1.15배 줌, 가로/세로 초점, 개별 제거, 실행 취소/다시 실행을 제공한다.
- v9 프로젝트에 원본 문장·출력 언어·시간 스냅샷을 저장한다. v1–v8은 빈 강조 목록으로 연다. 오래된 문장 스냅샷은 저장할 수 있지만 해당 효과의 출력은 재연결/제거 전까지 막는다.
- 무음 컷과 클립 범위를 원본 시각으로 매핑한다. 짧은 미리보기도 전체 편집본의 확대 곡선을 유지한다. 실제 프레임이 한 개 이하인 연속 효과 구간에서는 줌을 생략한다.
- 확대는 실제 보존 프레임의 시각에서 계산한 고정 캔버스 perspective 변환을 사용한다. 자막은 그 뒤에 합성한다. 동적 scale/crop의 입력 크기 갱신 문제는 격자 테스트에서 발견해 교체했다.
- 최대 20문장/4,000자 AI 제안을 지원한다. 기존 연결 또는 채팅 JSON 가져오기를 사용하며 원문 수정, 새 시각, 존재하지 않는 ID, 과도한 배율을 거부한다. 선택한 제안 전체가 한 번의 실행 취소 단위다. 원격 실제 모델 요청은 이번 검증에서 하지 않았다.

## 실행 결과

| 검사 | 결과 | 근거와 한계 |
| --- | --- | --- |
| TypeScript / Vite build | PASS | `npm run build` |
| JavaScript 전체 단위 검사 | PASS | `npm test`: 102개 통과. v9 마이그레이션 및 AI/강조 검증 포함 |
| Go 전체 동시성 검사 | PASS | `GOCACHE=/tmp/hypercut-accent-go-cache go test -race ./...` |
| 실제 줌 좌표 | PASS | 고정 격자의 x=40 선이 1.08배 중앙 확대 시 예상 x=30.4의 2픽셀 이내로 이동 |
| 실제 오디오 보존 | PASS | 같은 컷의 확대 전후 MP4에서 디코딩한 PCM이 바이트 단위로 같음 |
| 구간 미리보기 | PASS | 확대 진입 중간에서 시작하는 미리보기와 전체 출력의 해당 프레임 비교, 인코딩 차이 허용 |
| VFR 및 컷 교차 | PASS | 비균일 프레임 간격 원본에서 컷 교차 효과가 둘로 나뉘며 확대 전후 전체 프레임 시각 목록 일치 |
| 한국어 강조 자막 | PASS | 수동 한국어 자막이 들어간 합성 영상 MP4를 생성하고 프레임을 직접 확인. 실제 음성 전사 정확도 검사가 아님 |
| 브라우저 핵심 흐름 | PASS | 추가/실행 취소/다시 실행, AI JSON 거부·선택 적용, v9 저장·재열기, 인코딩 미리보기 재생, MP4 전체 디코딩, 오래된 강조의 출력 차단·재연결 |
| 좁은 화면 | PASS | 650px 뷰포트에서 강조 창 가로 넘침 없음. 데스크톱 캡처도 직접 확인해 창 너비 충돌 수정 |
| 개발용 Electron | PASS | v9 재열기, 제거·실행 취소, 실제 저장 IPC와 Go 검증, MP4 출력·전체 디코딩. 테스트가 파일 선택 대화상자 응답을 대체함 |
| 클라우드 프로젝트 계약 | PASS | 실제 Go bridge를 통한 v9 스냅샷 보존, v1–v8 이행, 불완전 v9 거부. 배포된 서버에서의 확인은 아님 |
| 실제 AI 품질/계정 연결 | NOT_RUN | provider 통신은 Go mock transport, UI 제안은 고정 JSON으로 검증 |
| 60분/대량 강조 성능 및 메모리 | NOT_RUN | 기존 렌더 대비 시간·메모리 목표는 아직 측정하지 않음 |
| 실제 한국어 녹화 3개와 HyperFrames 비교 | NOT_RUN | 선정된 실제 평가 녹화본과 비교 실행이 없음 |
| 서명·공증·패키지 배포 | NOT_RUN | 개발용 앱 검증이며 배포본 검증이 아님 |

## 재실행과 산출물

```sh
npm test
npm run build
npm run build:server
go test -race ./...
node scripts/visual-accents-e2e.mjs --desktop
```

Go 캐시 쓰기가 제한되면 `GOCACHE=/tmp/hypercut-accent-go-cache`를 사용한다. 로컬 서버 및 브라우저 테스트는 포트 바인딩과 Chrome/Electron 실행이 가능한 환경이 필요하다.

생성된 산출물은 git에서 제외되는 `test-output/visual-accents-e2e/`에 있다:

- `results.json`: 브라우저·Electron 실행 결과
- `editor-desktop.png`, `editor-narrow.png`: 실제 편집 화면
- `rendered-preview.png`, `output-frame.png`: 재생/출력 확인
- `accent-output.mp4`, `desktop-output.mp4`: 검증용 합성 영상
- `saved.hypercut.json`, `desktop.hypercut.json`: 저장 왕복 근거

실제 사용자 영상 편집 시간 단축이나 HyperFrames 대비 품질 우위는 아직 입증하지 않았다.
