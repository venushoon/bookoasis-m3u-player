# 📺 BookOasis M3U 라이브 플레이어 플러그인 (M3U Player Plugin)

BookOasis 미디어 서버의 좌측 사이드바에 독립된 풀페이지 뷰로 마운트되어 M3U/M3U8 실시간 방송 스트리밍과 XMLTV EPG 편성표를 제공하는 공식 규격 플러그인입니다.

---

## ✨ 주요 기능

* **라이브 스트리밍 재생 (HLS.js)**:
  * M3U/M3U8 포맷의 실시간 IPTV 방송 및 VOD 스트림 재생 지원
  * Hls.js 엔진 탑재 및 Safari 네이티브 HLS 지원
* **편성표 (XMLTV EPG) 실시간 연동**:
  * XMLTV 형식의 EPG 데이터를 분석하여 각 채널별 현재 방영 중인 프로그램명 실시간 표시
  * KST(+09:00) 표준 타임존 파서 및 채널명 퍼지 매칭(Fuzzy Matching) 알고리즘 적용
* **CORS 및 Mixed Content 대응**:
  * HTTPS 환경에서 비보안 HTTP 리소스 호출 시 발생하는 Mixed Content 방어
  * 외부 CORS 우회 프록시 커스텀 설정 지원
* **BookOasis 8종 테마 100% 동기화**:
  * BookOasis 대시보드 전역 CSS 변수(`var(--app-*)`) 연동을 통한 실시간 테마 반응
* **설정값 로컬 영구 저장**:
  * M3U URL, EPG URL, 프록시 주소 및 활성화 여부를 브라우저 로컬 스토리지에 기억
* **원클릭 자동 업데이트**:
  * `update_manifest` 계약을 통한 GitHub 기반 원클릭 최신 버전 업데이트 지원

---

## 📂 파일 구성 및 구조

```text
plugins/metadata/m3u_player/
  ├── __init__.py          # 모듈 패키지 진입점
  ├── m3u_player.py        # 플러그인 클래스 및 매니페스트 계약 선언
  ├── index.html           # 풀페이지 UI 템플릿
  ├── style.css            # 반응형 및 테마 연동 스타일시트
  ├── script.js            # M3U/EPG 파서, HLS 스트리밍 로직
  ├── VERSION              # 플러그인 버전 정보 (JSON)
  └── README.md            # 플러그인 설명 문서
```
---
## 💡 브라우저 CORS 우회 확장 프로그램 설정 가이드 (Chrome / Edge)


### 1. 확장 프로그램 설치
1. **Chrome 웹 스토어**에 접속합니다.
2. **`Allow CORS: Access-Control-Allow-Origin`**을 검색한 뒤 **[Chrome에 추가]**를 클릭하여 설치합니다.

---

### 2. 상단 툴바 고정 및 활성화 (ON/OFF)
1. 브라우저 우측 상단의 **확장 프로그램(🧩 퍼즐 모양)** 아이콘을 클릭합니다.
2. 목록에서 `Allow CORS` 항목 옆의 **핀(📌)** 아이콘을 눌러 상단 툴바에 고정합니다.
3. 툴바의 **`C` 아이콘**을 클릭하여 토글을 활성화합니다.
   * **주황색/유색 (ON)**: CORS 우회 적용 상태 (스트리밍 시청 가능)
   * **회색 (OFF)**: 비활성화 상태

---

### 3. 헤더 옵션 설정 (최초 1회)
1. 상단 툴바의 **`C` 아이콘 우클릭** → **[옵션(Options)]** 메뉴로 들어갑니다.
2. 다음 3개 필수 항목이 활성화되어 있는지 확인하고 저장합니다.
   * `Access-Control-Allow-Origin: *`
   * `Access-Control-Allow-Methods: *`
   * `Access-Control-Allow-Headers: *`

---

### 4. 적용 및 시청
1. BookOasis M3U 플레이어 화면으로 돌아와 **`Ctrl + F5` (Mac: `Cmd + Shift + R`)** 강력 새로고침을 실행합니다.
2. 채널을 선택하면 CORS 차단 없이 영상이 즉시 재생됩니다.

> ⚠️ **보안 권장 사항**:
> 브라우저의 전역 보안 정책을 일시적으로 해제하므로, **스트리밍을 시청할 때만 켜두고(ON)** 금융 거래나 일반 웹서핑 시에는 다시 클릭해 **비활성화(OFF/회색)**로 꺼두는 것을 권장합니다.

