# 기본 무음 편집의 입력 캐시 검증

2026-09-06. [기본 모드 재검증 계획](../plans/2026-09-06-thousand-cut-performance-plan.md)에 따라 기존 시험 도구에 파일 캐시 관측을 연결했다. 현재 인코더 동시 처리 2개 후보의 브라우저 번들·Mac 패키지를 사용했다. 제품 코드와 2GiB·시간·조작·취소 기준은 바꾸지 않았다.

## 변경한 시험 경로

`threshold-benchmark.mjs`는 기본 음량 모드로 실제 파일 가져오기·분석·MP4 출력·저장·복원/설정/재생 조작을 수행한다. 기존 기본 경로를 유지하고 `--input-cache=cold|warm`을 추가했다. 캐시 사본 준비는 분석 시간 밖에 기록하고, 선택 직전 상주 수와 분석 후·작업 후 사본 해시를 검사한다.

실행한 러너·서버 소스를 보존하고 브라우저 번들 및 Mac 패키지 내부 미디어·시간축·번들이 현재 파일과 같은지 확인한다. 기존 RSS 측정에 프로젝트 저장과 취소 단계도 추가했다. 완료된 성능 실패는 기록한 뒤 다음 조건으로 확장하지 않는다.

## 실제 두 앱의 60초 검사

[전체 실행 요약](results/2026-09-06-threshold-cache-smoke-summary.json)은 3조건 × Chrome/Mac × 2회, 총 **12회 통과**다. 합성 60초 영상의 16개 컷과 실제 출력 1,448프레임·PTS, 6개 A/V 표식 쌍, 전체 프로젝트를 확인했다. 전사·자막·효과음은 포함하지 않았다.

| 입력 조건 | 실행 수 | 선택 직전 상주 페이지 | 최대 합산 RSS GiB | 조작군 최대 p95 ms |
| --- | --- | --- | --- | --- |
| 기존 경로 | 4 | 관측·통제하지 않음 | 1.625 | 66.87 |
| cold | 4 | 매번 0 / 74 | 1.528 | 66.82 |
| warm | 4 | 매번 74 / 74 | 1.630 | 67.09 |

캐시 파일은 1,207,118바이트다. 모든 실제 MP4의 SHA-256은 `f6a0ca24ac51507d5eb61cec94b673cc3f96e3d9790651b0d3a9195e5147a7f1`로 일치했다. 각 조건의 분석 JSON과 저장 시각을 제외한 프로젝트 전체 필드도 두 앱·반복 간 일치했다. 기본 경로를 기준으로 cold와 warm을 비교했다. 첫 기본 실행과 자기 자신을 비교한 항목은 내부 일관성 검사이며 독립 정답 증거로 세지 않는다.

재분석 중 취소·재시도 6조건도 통과했다. 취소 직전 작업이 `running`인지 확인하고, 기존 프로젝트·저장 MP4와 입력 사본을 보존한 뒤 같은 앱의 다음 반복을 완료했다. 프로젝트 저장·취소를 포함한 RSS 원본을 보존했으며 최대 표본 간격은 약 318.82ms였다. 짧은 분석의 초기 단계 취소를 장시간 디코딩 중간 취소로 표현하지 않는다.

실행과 감사 원본: [기본](results/2026-09-06-threshold-cache-smoke-uncontrolled.json) / [감사](results/2026-09-06-threshold-cache-smoke-uncontrolled-audit.json), [cold](results/2026-09-06-threshold-cache-smoke-cold.json) / [감사](results/2026-09-06-threshold-cache-smoke-cold-audit.json), [warm](results/2026-09-06-threshold-cache-smoke-warm.json) / [감사](results/2026-09-06-threshold-cache-smoke-warm-audit.json).

## 결과 검증기의 대조

`audit-threshold-benchmark.py`는 실행 행렬 누락·중복, 현재/실행 소스 해시, 실제 출력·입력 해시, 프로젝트 전체, 원시 RSS 합·최댓값, UI 32회 통계, 프레임 수·시각과 싱크 기준, 캐시 관측 및 취소 후 2회차 완료를 검사한다. 실제 미디어 정답 검사는 러너에서 수행하며 감사 시 다시 실행한 것으로 집계하지 않는다.

[대조 기록](results/2026-09-06-threshold-cache-audit-controls.json)의 8조건은 정상 자료 1개 허용과 변조 자료 7개 거부다. 보고된 RSS 낮추기, UI p95 낮추기, 프레임 수 변경, 출력 해시 변경, 반복 누락, 프로젝트 변경, cold의 상주 페이지 변경을 각각 거부했다. 원래 결과·미디어는 수정하지 않고 새 시험 폴더의 자료만 바꿨다.

## 다음 단계와 재현

이번 결과는 시험 경로의 60초 확인이다. 이전 [60분 기본 모드의 2.050GiB 실패](2026-09-06-thousand-cut-performance-results.md)가 현재 후보에서 해결됐다고 아직 판단하지 않는다. 다음은 가장 먼저 실패했던 브라우저 60분 기본 모드를 cold 조건에서 3회 측정한다. 통과 후 warm·Mac·10분 조건을 순차 실행한다. 자막·효과음 합성의 캐시 행렬은 [별도 기록](2026-09-06-input-cache-results.md)으로 유지한다.

```sh
node scripts/threshold-benchmark.mjs --durations=60 --surfaces=browser,desktop --iterations=2 --ui-locator=css --input-cache=cold --output=test-output/새-기본-무음-시험
python3 scripts/audit-threshold-benchmark.py test-output/새-기본-무음-시험
```

실제 한국어 발화·작업 시간 절감·OS 전체 캐시·인증 AI 품질은 이 합성 시험으로 검증하지 않는다. 네이티브 파일 대화상자의 선택 경로는 시험이 지정했다.
