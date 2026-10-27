# 릴리스 가이드

Repo Tray는 GitHub Actions로 macOS Apple Silicon·Intel ZIP과 Windows x64 설치 프로그램을 빌드하고, 버전 태그를 기준으로 GitHub Releases에 공개합니다. 현재 배포는 **코드 서명 및 macOS 공증 없이** 진행하며 앱 내 자동 업데이트는 제공하지 않습니다.

## 워크플로

| 트리거 | 실행 내용 |
| --- | --- |
| `main` push / Pull Request | macOS·Windows에서 소스 검사, 테스트, 개발 앱 검증, 패키징 및 패키징 앱 검증 |
| `v*` 태그 push | 버전 일치 확인, OS별 검증·빌드 후 배포 파일 3개와 `SHA256SUMS.txt`를 GitHub Release에 공개 |

`package.json`, `package-lock.json`, 태그의 버전이 일치해야 합니다. 예를 들어 버전 `0.1.1`의 태그는 `v0.1.1`입니다. 릴리스 본문은 `docs/releases/0.1.1.md`처럼 해당 버전의 문서에 작성합니다.

워크플로가 구성되어 있다는 사실만으로 실행 성공을 의미하지 않습니다. 배포 여부와 결과는 [Actions 실행 기록](https://github.com/GGULBAE/repo-tray/actions)과 [Releases](https://github.com/GGULBAE/repo-tray/releases)를 확인하세요.

## 배포 전 준비

1. 변경 사항과 테스트를 정리하고 버전별 릴리스노트를 작성합니다. 사용자에게 영향을 주는 동작, 알려진 제약, 검증한 환경을 적습니다.
2. `package.json`과 `package-lock.json`의 버전을 함께 갱신합니다. 다음 릴리스가 `0.1.2`라면 `npm version 0.1.2 --no-git-tag-version`을 사용할 수 있습니다.
3. `npm ci`, `npm run verify`, `npm run test:desktop`을 실행합니다. 데스크탑 테스트는 GUI 세션에서 실행해야 합니다.
4. macOS에서는 `npm run dist:mac`, Windows에서는 `npm run dist:win`을 실행한 뒤 각각 `npm run test:packaged`로 빌드된 앱을 검증합니다. 격리된 테스트 설정을 사용하므로 실제 로그인 자동 실행 등록은 검증하지 않습니다.
5. 설치, 첫 실행, 창 닫기·트레이 재열기, 명시적 동기화, 실제 OS 로그인 자동 실행을 수동 확인한 환경을 기록합니다. 아직 확인하지 않은 플랫폼이나 기능은 릴리스노트에 구분해 적습니다.
6. 버전·소스·릴리스노트를 커밋하고 `main`에 반영한 후 해당 커밋의 CI 결과를 확인합니다.

태그를 push하면 공개 릴리스 절차가 시작됩니다. 예를 들어 첫 공개 버전은 다음과 같이 지정합니다.

```sh
git tag -a v0.1.1 -m "Repo Tray 0.1.1"
git push origin v0.1.1
```

이미 공개한 버전의 태그나 파일을 다른 내용으로 교체하지 마세요. 수정이 필요하면 버전을 올리고 새 릴리스로 배포합니다. GitHub Release를 게시하려면 저장소 Actions의 쓰기 권한과 해당 워크플로의 `contents: write` 권한이 필요합니다.

## 산출물 확인

0.1.1 기준 공개 파일은 다음과 같습니다.

| 파일 | 용도 |
| --- | --- |
| `Repo-Tray-0.1.1-mac-arm64.zip` | Apple Silicon Mac 앱 |
| `Repo-Tray-0.1.1-mac-x64.zip` | Intel Mac 앱 |
| `Repo-Tray-0.1.1-win-x64.exe` | Windows x64 NSIS 설치 프로그램 |
| `SHA256SUMS.txt` | 위 세 파일의 SHA-256 해시 |

배포 작업이 완료되면 파일 세 개와 체크섬, 릴리스 본문, [최신 릴리스 링크](https://github.com/GGULBAE/repo-tray/releases/latest)를 확인합니다. 해시는 배포 파일 생성 후 계산해야 합니다.

다운로드한 파일의 해시를 계산해 `SHA256SUMS.txt`의 같은 파일 항목과 비교할 수 있습니다.

```sh
# macOS
shasum -a 256 Repo-Tray-0.1.1-mac-arm64.zip
```

```powershell
# Windows PowerShell
Get-FileHash .\Repo-Tray-0.1.1-win-x64.exe -Algorithm SHA256
```

## 서명과 호환성

현재 프로젝트에는 배포용 서명 인증서가 설정되어 있지 않습니다. macOS 앱은 Developer ID 서명·Apple 공증을 받지 않았고, Windows 설치 프로그램도 서명되지 않았습니다. OS에서 경고 또는 실행 제한이 표시될 수 있음을 README와 릴리스노트에 유지합니다.

패키징 성공은 모든 실제 기기의 설치·실행 성공을 보장하지 않습니다. macOS의 두 CPU 아키텍처와 Windows에서 확인한 결과를 구분해 기록하세요. 개발 앱과 패키징 앱의 자동 검증은 격리된 Git 저장소·사용자 데이터로 실행하며, 사용자 저장소나 OS 로그인 항목을 변경하지 않습니다.

인증서·개인 키·GitHub 토큰을 저장소나 릴리스에 넣지 마세요. 이후 서명·공증을 도입할 때는 GitHub Actions secrets를 사용하고 문서의 배포 상태를 함께 수정합니다.
