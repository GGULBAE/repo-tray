# 기여 가이드

버그 제보와 개선 제안은 [Issues](https://github.com/GGULBAE/repo-tray/issues), 코드 변경은 Pull Request로 보내 주세요. 큰 동작 변경은 먼저 이슈에서 사용 상황과 원하는 결과를 설명하면 좋습니다.

## 개발 환경

Node.js 24 이상, Git, macOS 또는 Windows가 필요합니다.

```sh
git clone https://github.com/GGULBAE/repo-tray.git
cd repo-tray
npm ci
npm start
```

개발 실행은 OS 로그인 자동 실행을 등록하지 않습니다. 실제 개인 저장소 대신 테스트용 Git 저장소로 동기화 동작을 확인하세요.

## 변경 확인

```sh
npm run verify
npm run test:desktop
```

데스크탑 테스트는 GUI 세션에서 실행합니다. 임시 Git 원격·작업 저장소와 격리된 앱 설정을 사용하며 개인 저장소나 OS 로그인 항목을 변경하지 않습니다. 패키징과 관련된 변경은 해당 OS에서 `npm run dist:mac` 또는 `npm run dist:win`을 실행한 뒤 `npm run test:packaged`도 확인하세요.

PR에는 해결하는 문제, 변경 후 동작, 검증한 명령과 환경을 적어 주세요. Git 동작·탐색·설정 처리 변경에는 실제 재현 조건을 다루는 테스트를 추가하고 사용자 동작이 바뀌면 README도 수정합니다. 아직 실행하지 않은 환경의 결과는 구분해서 적습니다.

## 코드 구조와 작업 원칙

| 위치 | 역할 |
| --- | --- |
| `src/main.cjs`, `src/preload.cjs` | Electron 트레이·창·IPC 연결 |
| `src/core/git.cjs` | 상태 조회, fetch, 명시적 동기화와 충돌 처리 |
| `src/core/discovery.cjs` | 취소 가능한 탐색과 worktree 그룹화 |
| `src/core/monitor.cjs` | 저장소별 조회 예약과 상태 관리 |
| `src/core/store.cjs`, `src/core/login.cjs` | 설정 저장과 OS 로그인 실행 |
| `src/renderer/` | 한국어 사용자 화면 |
| `test/`, `scripts/smoke.cjs` | 코어 테스트와 실제 앱 검증 |

백그라운드 확인은 작업 파일을 수정하지 않고, merge/rebase 등 작업 파일 변경은 사용자의 명시적 동작으로 실행하는 원칙을 유지합니다. 로컬 수정을 강제로 버리거나 사용자 확인 없이 브랜치를 전환하지 않습니다. 보호 폴더 탐색은 사용자가 선택한 범위를 존중합니다.

UI는 외부 CDN 없이 동작하며 renderer의 Node 접근을 허용하지 않습니다. Git 인수는 shell 문자열에 합치지 않고 전달합니다. 이슈·스크린샷·로그에는 개인 경로, 이메일, 비공개 원격 URL, 토큰이나 키가 들어가지 않도록 확인해 주세요.

배포 과정은 [릴리스 가이드](docs/RELEASING.md)를 참고하세요. 이 프로젝트의 라이선스는 [MIT](LICENSE)입니다.
