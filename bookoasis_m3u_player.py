# -*- coding: utf-8 -*-
"""
bookoasis_m3u_player.py
------------------------
ALIVE 라이브 플레이어 - 설정(플레이리스트 소스/EPG/재생 옵션)을 서버 파일로
저장해 어느 기기에서 접속하든 같은 설정을 자동으로 불러온다.

⚠️ 설정 저장 위치
진짜 저장소는 DB(config_schema)가 아니라 파일이다:

    <앱 루트>/plugins/data/bookoasis_m3u_player/playlist.json

앱 루트는 이 파일 자신의 경로에서 "plugins" 디렉터리를 역산해 구한다
(_resolve_app_root 참고) — 서버 프로세스의 현재 작업 디렉터리(cwd)에
의존하지 않는다.

plugins/metadata/<id>/(플러그인 코드, 업데이트 시 통째로 교체됨)와 분리된
plugins/data/<id>/(플러그인 데이터, 재설치·업데이트에도 보존됨) 관례를 따른다.

동작 방식:
- get_dashboard_data(): playlist.json을 읽어 반환한다. 파일이 없으면 빈 설정을
  반환한다(프런트가 로컬 localStorage 백업값으로 폴백 처리).
- apply(action="save_settings"): 카테고리탭의 "⚙️ 소스 관리" 모달에서 저장을
  누르면 이 액션이 호출되어 playlist.json에 통째로 저장한다.

카테고리탭 프론트(script.js)는
    GET /api/media/dashboard/widgets/{plugin_id}/data?type={dbType}
로 get_dashboard_data(db_type, limit)의 반환값을 받아 설정을 로드하고,

    POST /api/media/books/0/apply-metadata
    body: {"type": db_type, "source": plugin_id, "item_data": {"action": "save_settings", "config": {...}}}
로 apply(db_type, book_id, item_data)를 호출해 설정을 저장한다 (book_id=0은 더미).
"""

import json
import os

from plugins.metadata.base import BaseMetadataProvider


_PLUGIN_ID_FOR_PATH = "bookoasis_m3u_player"


def _resolve_app_root():
    """plugins/data/ 절대 경로를 앱 실행 cwd에 의존하지 않고 계산한다.

    이 파일 자신의 경로(.../plugins/metadata/bookoasis_m3u_player/bookoasis_m3u_player.py)
    에서 "plugins" 디렉터리를 역산해 앱 루트를 찾는다. 예상치 못한 배치 구조라
    "plugins"를 못 찾으면 기존 동작(cwd 기준 상대경로)으로 안전하게 폴백한다.
    """
    this_dir = os.path.abspath(os.path.dirname(__file__))
    parts = this_dir.split(os.sep)
    if "plugins" in parts:
        last_plugins_idx = len(parts) - 1 - parts[::-1].index("plugins")
        root = os.sep.join(parts[:last_plugins_idx])
        if root:
            return root
    return "."


DATA_DIR = os.path.join(_resolve_app_root(), "plugins", "data", _PLUGIN_ID_FOR_PATH)
CONFIG_FILE = os.path.join(DATA_DIR, "playlist.json")

_PLUGIN_CODE_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(_PLUGIN_CODE_DIR, "VERSION")

CONFIG_SCOPE = "general"

DEFAULT_CONFIG = {
    "sources": [],
    "epgUrl1": "",
    "epgUrl2": "",
    "epgInterval": "60",
    "playbackMode": "smooth",
    "autoResume": False,
}


def _read_local_version():
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        version = str(data.get("plugin version") or "").strip()
        return version or None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None


class M3UPlayerPlugin(BaseMetadataProvider):
    id = "bookoasis_m3u_player"
    name = "ALIVE 라이브 플레이어"
    is_searchable = False

    # 사이드바 카테고리 1등 시민 메뉴 등록 규격
    category_tab = {
        "title": "ALIVE 플레이어",
        "icon": "fa-solid fa-tv",
        "order": 85,
        "sessions": "all",
    }

    config_schema = []

    # 원클릭 깃허브 자동 업데이트 계약
    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/venushoon/bookoasis-m3u-player/main",
        "files": [
            "__init__.py",
            "bookoasis_m3u_player.py",
            "index.html",
            "style.css",
            "script.js",
            "VERSION",
            "README.md",
        ],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": True,
    }

    def search(self, db_type, query):
        return {"success": True, "items": []}

    # ------------------------------------------------------------------
    # 설정 파일 읽기/쓰기
    # ------------------------------------------------------------------
    @staticmethod
    def _load_config_from_file():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except (json.JSONDecodeError, OSError):
            # 파일이 손상됐거나 읽기 실패 - 기본값으로 처리
            return None

    @staticmethod
    def _save_config_to_file(config):
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp_path = CONFIG_FILE + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        # 원자적 교체: 쓰는 도중 프로세스가 죽어도 기존 파일이 반쪽짜리로
        # 깨지지 않도록 임시 파일에 다 쓴 뒤 한 번에 이름을 바꾼다.
        os.replace(tmp_path, CONFIG_FILE)

    # ------------------------------------------------------------------
    # 카테고리탭 데이터 조회 (GET .../widgets/bookoasis_m3u_player/data?type=...)
    # ------------------------------------------------------------------
    def get_dashboard_data(self, db_type, limit=10):
        config = self._load_config_from_file()
        if config is None:
            config = dict(DEFAULT_CONFIG)

        return {
            "success": True,
            "config": config,
            "version": _read_local_version(),
            "items": [],
        }

    # ------------------------------------------------------------------
    # 소스 관리 모달 저장 (POST .../books/0/apply-metadata)
    # action 필드로 커스텀 기능을 구분한다.
    # ------------------------------------------------------------------
    def apply(self, db_type, book_id, item_data):
        if not isinstance(item_data, dict):
            return False, "ALIVE 플레이어 전용 플러그인입니다."

        action = item_data.get("action")

        if action == "save_settings":
            config = item_data.get("config")
            if not isinstance(config, dict):
                return False, "저장할 설정 정보가 없습니다."

            try:
                self._save_config_to_file(config)
            except OSError as e:
                return False, f"설정 파일 저장 실패: {e}"

            return True, "ALIVE 플레이어 설정이 저장되었습니다. (plugins/data/bookoasis_m3u_player/playlist.json)"

        return False, "알 수 없는 요청입니다."