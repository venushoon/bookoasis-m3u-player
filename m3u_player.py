# -*- coding: utf-8 -*-
from plugins.metadata.base import BaseMetadataProvider


class M3UPlayerPlugin(BaseMetadataProvider):
    id = "m3u_player"
    name = "M3U 라이브 플레이어"
    is_searchable = False

    # 사이드바 카테고리 메뉴 등록
    category_tab = {
        "title": "M3U 플레이어",
        "icon": "fa-solid fa-tv",
        "order": 85,
        "sessions": "all",
    }

    # 환경설정 입력 폼 스키마
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

    dashboard_widget = {
        "title": "M3U 플레이어",
        "subtitle": "실시간 스트리밍",
        "provider": "M3U Player",
        "icon": "fa-solid fa-tv",
        "limit": 10,
    }

    # GitHub 자동 업데이트 계약
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
        return {"success": True, "items": []}

    def apply(self, db_type, book_id, item_data):
        return False, "M3U 플레이어 전용 플러그인입니다."

    def get_dashboard_data(self, db_type, limit=10):
        """DB에 저장된 플러그인 환경설정값을 프론트엔드로 전달"""
        config = self.get_plugin_config(db_type, default={})
        return {
            "success": True,
            "items": [],
            "config": config,
        }
