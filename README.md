# Repo Tray

Quiet Git monitoring for the macOS menu bar and Windows system tray.

여러 컴퓨터에서 작업할 때, 다른 곳에서 push한 변경을 놓치지 않도록 알려 주는 데스크탑 앱입니다. 등록한 Git 저장소를 주기적으로 확인하고 원격 변경이 있으면 **트레이 아이콘을 빨간색으로 표시**합니다. 작업 파일은 사용자가 **동기화**를 누를 때만 변경합니다.

[최신 버전 다운로드](https://github.com/GGULBAE/repo-tray/releases/latest) · [릴리스 기록](https://github.com/GGULBAE/repo-tray/releases) · [문제 제보](https://github.com/GGULBAE/repo-tray/issues)

## 다운로드와 설치

최신 릴리스의 **Assets**에서 컴퓨터에 맞는 파일을 받으세요.

| 컴퓨터 | 다운로드 파일 | 설치 방법 |
| --- | --- | --- |
| Apple Silicon Mac (M1 이후) | `Repo-Tray-<버전>-mac-arm64.zip` | 압축을 풀고 `Repo Tray.app`을 응용 프로그램 폴더로 옮깁니다. |
| Intel Mac | `Repo-Tray-<버전>-mac-x64.zip` | 압축을 풀고 `Repo Tray.app`을 응용 프로그램 폴더로 옮깁니다. |
| Windows x64 | `Repo-Tray-<버전>-win-x64.exe` | 설치 프로그램을 실행합니다. |

대상 환경은 macOS 13 이상과 Windows 10 이상입니다. **Git을 별도로 설치해야 합니다.** 터미널에서 `git --version`이 실행되는지 확인하세요. 설치 파일로 앱을 사용하는 데 Node.js는 필요하지 않습니다.

**현재 0.1.1 배포물은 코드 서명되지 않았고, macOS 공증도 받지 않았습니다.** macOS Gatekeeper나 Windows SmartScreen에서 경고 또는 실행 제한이 표시될 수 있습니다. 릴리스에 첨부된 `SHA256SUMS.txt`로 다운로드한 파일의 해시를 확인할 수 있습니다. 해시 확인은 파일 무결성 확인이며 개발자 서명이나 Apple 공증을 대신하지는 않습니다.

앱 내 자동 업데이트는 아직 없습니다. 새 버전은 [Releases](https://github.com/GGULBAE/repo-tray/releases/latest)에서 받아 앱을 종료한 뒤 교체하거나 설치하세요.

## 노트북과 데스크탑에서 사용하기

1. **두 컴퓨터에 같은 프로젝트를 clone하고 작업할 브랜치를 준비합니다.** 평소 사용하는 SSH 키나 Git credential helper로 해당 저장소의 `git fetch`가 되는지 확인합니다.
2. 각 컴퓨터의 Repo Tray에서 **저장소 찾기 → 기본 폴더에서 찾기** 또는 **폴더 선택**을 누릅니다. 이름과 실제 경로를 확인해 모니터링할 저장소를 등록합니다.
3. 조회 주기를 설정합니다. **1시간, 5시간, 1일** 또는 **1~10,080분**을 직접 지정할 수 있습니다. 저장소마다 다르게 설정할 수 있습니다.
4. 한 컴퓨터에서 평소처럼 commit하고 push합니다. 다른 컴퓨터는 다음 조회 때 원격 변경을 확인하고 트레이를 빨간색으로 표시합니다. 바로 확인하려면 앱의 수동 확인 버튼을 누릅니다.
5. 트레이를 클릭해 새 커밋과 로컬 작업 상태를 확인한 뒤 **동기화**를 누릅니다.

창을 닫아도 앱은 트레이에 남습니다. 시스템 팝업이나 소리는 보내지 않습니다. 완전히 종료하려면 트레이 메뉴의 종료를 사용하세요. 로그인 시 자동 실행은 설정에서 변경할 수 있습니다.

Repo Tray 계정을 만들거나 이메일·토큰을 입력할 필요가 없습니다. 컴퓨터마다 기존 Git 인증을 사용하므로 같은 개인 Git 계정으로 사용할 수 있습니다. 앱이 직접 clone, commit, push하거나 브랜치를 자동 전환하지는 않습니다. 아직 push하지 않은 변경은 다른 컴퓨터로 전달되지 않습니다.

## 동기화는 어떻게 동작하나요?

- **주기적인 확인:** `git fetch`로 원격 상태를 가져옵니다. 현재 브랜치의 upstream과 다른 원격 브랜치 변경을 표시하며 작업 파일은 수정하지 않습니다.
- **일반 동기화:** 로컬 수정이 없고 이력이 이어지면 fast-forward로 반영합니다.
- **양쪽에서 커밋한 경우:** 앱이 차이를 표시하고 사용자가 merge 또는 rebase를 선택합니다. 자동으로 선택하지 않습니다.
- **작업 중인 파일이 있는 경우:** 동기화를 보류합니다. 로컬 수정, detached HEAD, upstream 미설정, 진행 중인 Git 작업 등 보류 이유를 표시합니다.
- **충돌이 생긴 경우:** 충돌 파일 목록과 merge/rebase 중단 버튼을 제공합니다. 파일 편집과 충돌 해결은 평소 사용하는 에디터나 Git 클라이언트에서 진행합니다.
- **다른 원격 브랜치만 바뀐 경우:** 내용을 확인하고 **확인했어요**로 표시를 정리할 수 있습니다. 현재 브랜치에 받아야 할 변경이나 충돌은 계속 표시합니다.

네트워크·인증 오류와 마지막 확인 시각을 앱에서 볼 수 있습니다. 컴퓨터가 꺼져 있거나 앱이 종료된 동안에는 확인하지 않습니다.

## 저장소 탐색과 접근 권한

첫 실행 때는 빈 목록에서 시작하며, 사용자가 선택하기 전에는 디스크를 자동 탐색하지 않습니다.

**기본 폴더에서 찾기**는 사용자 홈의 일반 폴더를 검색합니다. 문서, 데스크탑, 다운로드, 사진, Library, 클라우드 폴더, 외장 볼륨 등 별도 권한이 필요한 위치는 자동 탐색에서 제외합니다. 이 위치에 있는 저장소는 **폴더 선택**으로 프로젝트 폴더를 직접 지정하세요. 탐색 중에는 취소할 수 있으며 접근할 수 없는 경로는 결과에 표시합니다.

한 번 접근이 거부된 경로는 기억해 반복 탐색하지 않습니다. 다시 시도하려면 해당 폴더를 직접 선택하세요. 이미 등록되었거나 macOS 승인을 기다리는 로그인 항목도 실행할 때마다 다시 등록하지 않습니다.

일반 저장소와 하위의 별도 저장소, Git worktree를 찾을 수 있습니다. 같은 Git 데이터를 공유하는 worktree는 **한 행으로 묶어** 실제 모니터링할 작업 폴더를 선택하도록 합니다. 이미 등록한 그룹은 중복 등록할 수 없습니다. 별도로 clone한 저장소는 각각 표시합니다. 원본 Git 데이터가 다른 보호 폴더에 있는 worktree는 원본 프로젝트 폴더도 함께 선택해야 발견할 수 있습니다. Bare 저장소는 탐색 결과에 표시하지만 동기화 대상으로 등록하지 않습니다.

기존 버전에서 여러 worktree를 등록했다면 그 설정을 자동으로 삭제하지 않습니다. 저장소를 이동한 경우 기존 등록을 해제하고 새 경로로 등록하세요.

## 설정과 데이터

저장소 경로·조회 주기·중복 식별 정보·접근 거부 경로는 컴퓨터의 `config.json`에 저장합니다. Git 비밀번호나 인증 토큰은 보관하지 않습니다.

- macOS: `~/Library/Application Support/Repo Tray/config.json`
- Windows: `%APPDATA%/Repo Tray/config.json`

설정은 컴퓨터별로 관리합니다. 손상된 설정 파일은 사본을 보존한 뒤 기본값으로 시작합니다.

## 소스에서 실행하기

개발 환경은 **Node.js 24 이상**, **Git**, macOS 또는 Windows입니다.

```sh
git clone https://github.com/GGULBAE/repo-tray.git
cd repo-tray
npm ci
npm start
```

개발 모드에서는 OS 로그인 자동 실행을 등록하지 않습니다. 패키징한 앱은 설정에 따라 등록합니다.

```sh
npm run verify
npm run test:desktop
```

`verify`는 소스 검사와 Git·설정·예약 테스트를 실행합니다. `test:desktop`은 격리된 설정과 임시 Git 저장소로 실제 Electron 앱을 검증하므로 GUI 세션이 필요합니다. 개인 저장소와 OS 로그인 항목은 변경하지 않습니다.

배포 파일을 만들려면 해당 OS에서 다음 명령을 사용하세요.

```sh
# macOS: Apple Silicon 및 Intel ZIP
npm run dist:mac

# Windows: x64 설치 프로그램
npm run dist:win

# 현재 OS의 빌드된 앱 검증 (위 빌드 후 실행)
npm run test:packaged
```

산출물은 `release/`에 생성됩니다. 공개 CI와 배포 절차는 [릴리스 가이드](docs/RELEASING.md), 변경 제안은 [기여 가이드](CONTRIBUTING.md)를 참고하세요. 실제 CI 결과는 [Actions](https://github.com/GGULBAE/repo-tray/actions)에서 확인할 수 있습니다.

## 검증 범위

0.1.1 공개 준비 과정에서 Git·탐색·설정·예약·로그인·릴리스 관련 테스트 **58개**와 Apple Silicon Mac의 개발 앱·패키징 앱 실행 검증을 통과했습니다. worktree 그룹화, 중복 등록 방지, 원격 확인, 빨간 트레이, 명시적 동기화, 로컬 수정 보호, 조회 주기 저장, 창 숨기기와 재열기를 확인했습니다.

Intel Mac ZIP과 Windows x64 설치 파일도 생성했으며, Intel Mac과 Windows의 실제 컴퓨터에서 설치·로그인 자동 시작까지 검증한 것은 아닙니다. GitHub Actions의 macOS·Windows 검증 결과는 각 실행 기록을 기준으로 확인하세요.

## 라이선스

[MIT](LICENSE)
