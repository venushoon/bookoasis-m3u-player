# -*- coding: utf-8 -*-
from plugins.metadata.base import BaseMetadataProvider


class M3UPlayerPlugin(BaseMetadataProvider):
    id = "m3u_player"
    name = "M3U 라이브 플레이어"
    is_searchable = False

    # 사이드바 카테고리 1등 시민 메뉴 등록 규격
    category_tab = {
        "title": "M3U 플레이어",
        "icon": "fa-solid fa-tv",
        "order": 85,
        "sessions": "all",  # general, adult, audiobook, video 모든 세션 사이드바에 노출
    }

    # 플러그인 환경설정 스키마
    config_schema = [
        {
            "key": "DEFAULT_M3U_URL",
            "label": "기본 M3U/M3U8 재생목록 URL",
            "type": "text",
            "required": False,
        },
        {
            "key": "AUTO_PLAY",
            "label": "채널 선택 시 자동 재생",
            "type": "checkbox",
            "default": True,
        },
    ]

    # 원클릭 깃허브 자동 업데이트 계약
    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/venushoon/bookoasis-m3u-player/main",
        "files": [
            "__init__.py",
            "m3u_player.py",
            "index.html",
            "style.css",
            "script.js",
            "VERSION",
        ],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": True,
    }

    def search(self, db_type, query):
        """메타데이터 검색 미지원 플러그인"""
        return {"success": True, "items": []}

    def apply(self, db_type, book_id, item_data):
        """메타데이터 적용 미지원 플러그인"""
        return False, "M3U 플레이어 전용 플러그인입니다."

    def get_dashboard_data(self, db_type, limit=10):
        """대시보드 위젯 기본 응답"""
        return {"success": True, "items": []}
