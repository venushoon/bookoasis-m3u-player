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
