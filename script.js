(function () {
    // SPA 재진입 시 이전 인스턴스 전역 클린업
    if (typeof window.__ALIVE_CLEANUP__ === 'function') {
        window.__ALIVE_CLEANUP__();
    }

    // 전역 세션 캐시
    window.__ALIVE_CACHE__ = window.__ALIVE_CACHE__ || {
        channels: [],
        epgData1: {},
        epgData2: {},
        lastChannel: null,
        channelHealth: {},
        loaded: false
    };

    function ensureHlsLoaded(callback) {
        if (window.Hls) {
            callback();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
        script.onload = callback;
        document.head.appendChild(script);
    }

    const LS_PREFIX = 'bookoasis_m3u_player_';
    const PLUGIN_ID = 'bookoasis_m3u_player';
    const CONFIG_SCOPE = 'general';

    // 서버(bookoasis_m3u_player.py)의 playlist.json에서 설정을 읽어온다.
    // 실패하면 null을 반환 — 호출부는 localStorage 값으로 폴백한다.
    async function loadConfigFromServer() {
        try {
            const res = await fetch(`/api/media/dashboard/widgets/${PLUGIN_ID}/data?type=${CONFIG_SCOPE}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data && data.success === false) throw new Error(data.error || 'success:false');
            if (data && data.config && typeof data.config === 'object') {
                return data.config;
            }
            return null;
        } catch (e) {
            console.warn('[ALIVE Player] 서버 설정 조회 실패, 로컬 값을 사용합니다:', e.message);
            return null;
        }
    }

    // 현재 설정을 서버(playlist.json)에 저장한다. 성공/실패를 { ok, message } 형태로 반환.
    async function saveConfigToServer(config) {
        try {
            const res = await fetch('/api/media/books/0/apply-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: CONFIG_SCOPE,
                    source: PLUGIN_ID,
                    item_data: { action: 'save_settings', config },
                }),
            });
            if (res.status === 401 || res.status === 403) {
                return { ok: false, message: '권한이 없습니다 (관리자 계정만 설정을 저장할 수 있습니다).' };
            }
            const result = await res.json().catch(() => null);
            if (!res.ok || (result && result.success === false)) {
                return { ok: false, message: (result && (result.error || result.message)) || `HTTP ${res.status}` };
            }
            return { ok: true, message: (result && result.message) || '저장되었습니다.' };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }

    const LS = {
        url1: LS_PREFIX + 'url1',
        url2: LS_PREFIX + 'url2',
        sources: LS_PREFIX + 'sources',
        epgUrl1: LS_PREFIX + 'epg_url1',
        epgUrl2: LS_PREFIX + 'epg_url2',
        epgInterval: LS_PREFIX + 'epg_interval',
        favorites: LS_PREFIX + 'favorites',
        sidebarCollapsed: LS_PREFIX + 'sidebar_collapsed',
        playbackMode: LS_PREFIX + 'playback_mode',
        autoResume: LS_PREFIX + 'autoresume',
        lastUrl: LS_PREFIX + 'last_url',
    };

    function migrateLegacyStorageKeys() {
        const legacyMap = {
            'hoon_m3u_url1': LS.url1,
            'hoon_m3u_url2': LS.url2,
            'hoon_epg_url1': LS.epgUrl1,
            'hoon_epg_url2': LS.epgUrl2,
            'hoon_epg_interval': LS.epgInterval,
            'hoon_m3u_favorites': LS.favorites,
            'bookoasis_m3u_sidebar_collapsed': LS.sidebarCollapsed,
            'bookoasis_m3u_playback_mode': LS.playbackMode,
            'bookoasis_m3u_autoresume': LS.autoResume,
            'bookoasis_m3u_last_url': LS.lastUrl,
        };
        Object.entries(legacyMap).forEach(([oldKey, newKey]) => {
            const val = localStorage.getItem(oldKey);
            if (val !== null && localStorage.getItem(newKey) === null) {
                localStorage.setItem(newKey, val);
            }
            localStorage.removeItem(oldKey);
        });

        // url1/url2(고정 2슬롯) → sources(가변 배열) 이관
        if (localStorage.getItem(LS.sources) === null) {
            const legacyUrl1 = localStorage.getItem(LS.url1) || '';
            const legacyUrl2 = localStorage.getItem(LS.url2) || '';
            const migratedSources = [];
            if (legacyUrl1) migratedSources.push({ id: 'src_' + Date.now() + '_1', name: '소스1', url: legacyUrl1 });
            if (legacyUrl2) migratedSources.push({ id: 'src_' + Date.now() + '_2', name: '소스2', url: legacyUrl2 });
            localStorage.setItem(LS.sources, JSON.stringify(migratedSources));
            localStorage.removeItem(LS.url1);
            localStorage.removeItem(LS.url2);
        }
    }

    function initM3UPlayer() {
        migrateLegacyStorageKeys();
        const container = document.querySelector('.m3u-container');
        const sidebar = document.getElementById('m3u-sidebar');
        const hotspot = document.getElementById('m3u-sidebar-hotspot');
        const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
        const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

        const btnOpenSources = document.getElementById('btn-open-sources');
        const btnCheckHealth = document.getElementById('btn-check-health');
        const btnRefreshAll = document.getElementById('btn-refresh-all');

        const modalOverlay = document.getElementById('m3u-modal-overlay');
        const btnCloseModal = document.getElementById('btn-close-modal');
        const btnModalCancel = document.getElementById('btn-modal-cancel');
        const btnModalSave = document.getElementById('btn-modal-save');

        const btnAddSource = document.getElementById('btn-add-source');
        const sourceListEl = document.getElementById('m3u-source-list');
        const cfgEpgUrl1 = document.getElementById('cfg-epg-url1');
        const cfgEpgUrl2 = document.getElementById('cfg-epg-url2');
        const cfgEpgInterval = document.getElementById('cfg-epg-interval');
        const cfgPlaybackMode = document.getElementById('cfg-playback-mode');
        const cfgAutoResume = document.getElementById('cfg-auto-resume');

        const sourceSelect = document.getElementById('m3u-source-select');
        const groupSelect = document.getElementById('m3u-group-select');
        const searchInput = document.getElementById('m3u-search-input');
        const channelList = document.getElementById('m3u-channel-list');
        const channelCountBadge = document.getElementById('channel-count-badge');
        const healthStatusBadge = document.getElementById('health-status-badge');
        const loadingSpinner = document.getElementById('loading-spinner');

        const videoElement = document.getElementById('video-element');
        const videoOverlayMsg = document.getElementById('video-overlay-msg');
        const btnFavCurrent = document.getElementById('btn-fav-current');
        const currentChannelName = document.getElementById('current-channel-name');
        const currentChannelGroup = document.getElementById('current-channel-group');
        const currentResolutionBadge = document.getElementById('current-resolution-badge');
        const currentEpgInfo = document.getElementById('current-epg-info');
        const btnReloadStream = document.getElementById('btn-reload-stream');

        if (!btnOpenSources || !videoElement || !container || !sidebar || !btnSidebarToggle) return;

        let allChannels = window.__ALIVE_CACHE__.channels || [];
        let filteredChannels = [];
        let epgData1 = window.__ALIVE_CACHE__.epgData1 || {}; 
        let epgData2 = window.__ALIVE_CACHE__.epgData2 || {}; 
        let channelHealth = window.__ALIVE_CACHE__.channelHealth || {}; 
        let favorites = []; 
        let currentChannel = window.__ALIVE_CACHE__.lastChannel || null;
        let hls = null;
        let epgTimer = null;
        let autoHideTimer = null;
        let lastVisibleState = true;

        // 사이드바 상태 제어
        let isSidebarCollapsed = localStorage.getItem(LS.sidebarCollapsed) === 'true';

        function updateSidebarUI(triggerTempShow = false) {
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }

            if (isSidebarCollapsed) {
                container.classList.add('sidebar-collapsed');
                btnSidebarToggle.setAttribute('title', '채널 목록 펼치기');

                if (triggerTempShow) {
                    btnSidebarToggle.classList.add('show-temporarily');
                    autoHideTimer = setTimeout(() => {
                        btnSidebarToggle.classList.remove('show-temporarily');
                    }, 3000);
                } else {
                    btnSidebarToggle.classList.remove('show-temporarily');
                }
            } else {
                container.classList.remove('sidebar-collapsed');
                btnSidebarToggle.classList.remove('show-temporarily');
                btnSidebarToggle.setAttribute('title', '채널 목록 접기');
            }
            localStorage.setItem(LS.sidebarCollapsed, isSidebarCollapsed ? 'true' : 'false');
        }

        updateSidebarUI(false);

        // 유휴 3초 자동 숨김 + 호버 시 즉시 표시
        let idleHideTimer = null;

        function clearIdleHideTimer() {
            if (idleHideTimer) {
                clearTimeout(idleHideTimer);
                idleHideTimer = null;
            }
        }

        function scheduleIdleHide() {
            clearIdleHideTimer();
            idleHideTimer = setTimeout(() => {
                if (!container.classList.contains('sidebar-collapsed')) {
                    container.classList.add('sidebar-collapsed');
                }
            }, 3000);
        }

        function revealSidebarOnHover() {
            clearIdleHideTimer();
            if (container.classList.contains('sidebar-collapsed')) {
                container.classList.remove('sidebar-collapsed');
            }
        }

        sidebar.addEventListener('mouseenter', revealSidebarOnHover);
        sidebar.addEventListener('mouseleave', scheduleIdleHide);
        hotspot.addEventListener('mouseenter', revealSidebarOnHover);
        btnSidebarToggle.addEventListener('mouseenter', revealSidebarOnHover);

        if (!isSidebarCollapsed) scheduleIdleHide();

        function toggleSidebar(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            clearIdleHideTimer();
            isSidebarCollapsed = !isSidebarCollapsed;
            updateSidebarUI(true);
            if (!isSidebarCollapsed) scheduleIdleHide();
        }

        btnSidebarToggle.onclick = toggleSidebar;
        if (btnToggleSidebar) btnToggleSidebar.onclick = toggleSidebar;

        // 이벤트 위임
        container.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('#btn-sidebar-toggle, #btn-toggle-sidebar');
            if (toggleBtn) {
                toggleSidebar(e);
            }
        });

        function isAutoResumeEnabled() {
            return localStorage.getItem(LS.autoResume) === 'true';
        }

        function isPipActive() {
            return (
                document.pictureInPictureElement === videoElement ||
                (videoElement.webkitPresentationMode && videoElement.webkitPresentationMode === 'picture-in-picture')
            );
        }

        function isElementVisible(el) {
            if (!el || !document.body.contains(el)) return false;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            
            let curr = el;
            while (curr && curr !== document.body) {
                const style = window.getComputedStyle(curr);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return false;
                }
                curr = curr.parentElement;
            }
            return true;
        }

        function stopPlayback() {
            if (hls) {
                try {
                    hls.stopLoad();
                    hls.detachMedia();
                    hls.destroy();
                } catch (e) {}
                hls = null;
            }

            if (videoElement) {
                videoElement.pause();
                videoElement.removeAttribute('src');
                videoElement.load();
            }
        }

        function resetToInitialUI() {
            stopPlayback();
            currentChannel = null;
            window.__ALIVE_CACHE__.lastChannel = null;
            if (currentChannelName) currentChannelName.textContent = '선택된 채널 없음';
            if (currentChannelGroup) currentChannelGroup.textContent = '그룹: -';
            if (currentEpgInfo) currentEpgInfo.textContent = '편성 정보 없음';
            if (currentResolutionBadge) currentResolutionBadge.style.display = 'none';
            if (videoOverlayMsg) {
                videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
                videoOverlayMsg.style.display = 'block';
            }
            updateFavButtons();
            renderChannelList();
        }

        function cleanupAll() {
            stopPlayback();

            if (epgTimer) {
                clearInterval(epgTimer);
                epgTimer = null;
            }
            if (visibilityObserver) visibilityObserver.disconnect();
            if (mutationObserver) mutationObserver.disconnect();
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }
            clearIdleHideTimer();
            window.removeEventListener('popstate', handleNavChange);
            window.removeEventListener('hashchange', handleNavChange);
            window.removeEventListener('beforeunload', cleanupAll);
        }

        window.__ALIVE_CLEANUP__ = cleanupAll;

        function onTabRestored() {
            updateSidebarUI(false);
            if (!isSidebarCollapsed) scheduleIdleHide();

            if (!window.__ALIVE_CACHE__.loaded || allChannels.length === 0) {
                refreshAllSources(false);
            } else {
                updateFilterSelects();
                applyFilter();

                if (isAutoResumeEnabled()) {
                    if (currentChannel) {
                        playChannel(currentChannel);
                    } else {
                        const lastUrl = localStorage.getItem(LS.lastUrl);
                        if (lastUrl) {
                            const found = allChannels.find(c => c.url === lastUrl);
                            if (found) playChannel(found);
                        }
                    }
                } else {
                    resetToInitialUI();
                }
            }
        }

        function handleVisibilityChange() {
            const currentlyVisible = isElementVisible(container);

            if (!lastVisibleState && currentlyVisible) {
                lastVisibleState = true;
                onTabRestored();
            } else if (lastVisibleState && !currentlyVisible) {
                lastVisibleState = false;
                if (!isPipActive()) {
                    if (hls || (videoElement && !videoElement.paused)) {
                        stopPlayback();
                    }
                }
            }
        }

        // IntersectionObserver: 뷰포트 진입/이탈 감지 (display:none 전환은 감지 못함)
        const visibilityObserver = new IntersectionObserver(() => {
            handleVisibilityChange();
        }, { threshold: 0.01 });
        visibilityObserver.observe(container);

        // MutationObserver: display:none 등 style/class 전환 감지 (부모 트리 포함)
        const mutationObserver = new MutationObserver(() => {
            handleVisibilityChange();
        });
        let mutationTarget = container.parentElement || container;
        mutationObserver.observe(mutationTarget, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            subtree: true,
        });

        videoElement.addEventListener('leavepictureinpicture', () => {
            setTimeout(() => {
                if (!isElementVisible(container)) {
                    stopPlayback();
                }
            }, 50);
        });

        function handleNavChange() {
            if (!isPipActive() && !isElementVisible(container)) {
                stopPlayback();
            }
        }

        window.addEventListener('popstate', handleNavChange);
        window.addEventListener('hashchange', handleNavChange);
        window.addEventListener('beforeunload', cleanupAll);

        document.addEventListener('click', (e) => {
            const navTarget = e.target.closest('a, button, [data-category], [data-tab], .sidebar-item, .nav-link');
            if (navTarget && !container.contains(navTarget)) {
                setTimeout(handleNavChange, 50);
            }
        });

        async function resolveProxyUrl(url) {
            if (!url) return null;
            if (window.BookOasisPlugin && typeof window.BookOasisPlugin.getProxyUrl === 'function') {
                const proxied = await window.BookOasisPlugin.getProxyUrl(url);
                return proxied || url;
            }
            return url;
        }

        async function resolveStreamUrl(url) {
            if (!url) return null;
            if (window.BookOasisPlugin && typeof window.BookOasisPlugin.getStreamProxyUrl === 'function') {
                const streamProxied = await window.BookOasisPlugin.getStreamProxyUrl(url);
                return streamProxied || url;
            }
            return url;
        }

        function cleanChannelName(str) {
            if (!str) return '';
            return str
                .replace(/\([^)]*\)/g, '')   
                .replace(/\[[^\]]*\]/g, '')   
                .replace(/FHD|HD|UHD|4K|PLUS|플러스|TV|티비|티빙|tving/gi, '')
                .replace(/[\s\-_.:]/g, '')
                .toLowerCase();
        }

        function loadFavorites() {
            try {
                favorites = JSON.parse(localStorage.getItem(LS.favorites) || '[]');
            } catch (e) {
                favorites = [];
            }
        }

        function toggleFavorite(channel) {
            const idx = favorites.indexOf(channel.name);
            if (idx > -1) {
                favorites.splice(idx, 1);
            } else {
                favorites.push(channel.name);
            }
            localStorage.setItem(LS.favorites, JSON.stringify(favorites));
            updateFavButtons();
            if (groupSelect.value === 'FAVORITES') {
                applyFilter();
            } else {
                renderChannelList();
            }
        }

        function updateFavButtons() {
            if (!currentChannel) {
                btnFavCurrent.classList.remove('active');
                btnFavCurrent.innerHTML = '<i class="fa-regular fa-star far fa-star"></i>';
                return;
            }
            const isFav = favorites.includes(currentChannel.name);
            btnFavCurrent.classList.toggle('active', isFav);
            btnFavCurrent.innerHTML = isFav ? '<i class="fa-solid fa-star fas fa-star"></i>' : '<i class="fa-regular fa-star far fa-star"></i>';
        }

        btnFavCurrent.onclick = () => {
            if (currentChannel) toggleFavorite(currentChannel);
        };

        function getSources() {
            try {
                const parsed = JSON.parse(localStorage.getItem(LS.sources) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }

        function renderSourceRows(sources) {
            if (!sourceListEl) return;
            sourceListEl.innerHTML = '';
            sources.forEach((src) => {
                const row = document.createElement('div');
                row.className = 'm3u-source-row';
                row.dataset.sourceId = src.id;

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'm3u-input m3u-source-name';
                nameInput.placeholder = '소스명';
                nameInput.value = src.name || '';

                const urlInput = document.createElement('input');
                urlInput.type = 'text';
                urlInput.className = 'm3u-input m3u-source-url';
                urlInput.placeholder = 'https://.../playlist.m3u';
                urlInput.value = src.url || '';

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn-remove-source';
                removeBtn.title = '소스 삭제';
                removeBtn.innerHTML = '<i class="fa-solid fa-trash fas fa-trash"></i>';
                removeBtn.onclick = () => row.remove();

                row.appendChild(nameInput);
                row.appendChild(urlInput);
                row.appendChild(removeBtn);
                sourceListEl.appendChild(row);
            });
        }

        function addSourceRow(name = '', url = '') {
            const sources = readSourceRowsFromDOM();
            sources.push({ id: 'src_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: name || `소스${sources.length + 1}`, url });
            renderSourceRows(sources);
        }

        function readSourceRowsFromDOM() {
            if (!sourceListEl) return [];
            return Array.from(sourceListEl.querySelectorAll('.m3u-source-row')).map((row) => ({
                id: row.dataset.sourceId,
                name: row.querySelector('.m3u-source-name').value.trim() || '이름없음',
                url: row.querySelector('.m3u-source-url').value.trim(),
            })).filter((s) => s.url);
        }

        if (btnAddSource) btnAddSource.onclick = () => addSourceRow();

        function openModal() {
            renderSourceRows(getSources());
            cfgEpgUrl1.value = localStorage.getItem(LS.epgUrl1) || '';
            cfgEpgUrl2.value = localStorage.getItem(LS.epgUrl2) || '';
            cfgEpgInterval.value = localStorage.getItem(LS.epgInterval) || '60';
            cfgPlaybackMode.value = localStorage.getItem(LS.playbackMode) || 'smooth';
            cfgAutoResume.checked = localStorage.getItem(LS.autoResume) === 'true';
            modalOverlay.style.display = 'flex';
        }

        function closeModal() {
            modalOverlay.style.display = 'none';
        }

        btnOpenSources.onclick = openModal;
        btnCloseModal.onclick = closeModal;
        btnModalCancel.onclick = closeModal;

        btnModalSave.onclick = async () => {
            const config = {
                sources: readSourceRowsFromDOM(),
                epgUrl1: cfgEpgUrl1.value.trim(),
                epgUrl2: cfgEpgUrl2.value.trim(),
                epgInterval: cfgEpgInterval.value,
                playbackMode: cfgPlaybackMode.value,
                autoResume: cfgAutoResume.checked,
            };

            // 서버 저장 실패에 대비한 로컬 백업(이 브라우저 한정 폴백)
            localStorage.setItem(LS.sources, JSON.stringify(config.sources));
            localStorage.setItem(LS.epgUrl1, config.epgUrl1);
            localStorage.setItem(LS.epgUrl2, config.epgUrl2);
            localStorage.setItem(LS.epgInterval, config.epgInterval);
            localStorage.setItem(LS.playbackMode, config.playbackMode);
            localStorage.setItem(LS.autoResume, config.autoResume ? 'true' : 'false');

            const originalBtnHtml = btnModalSave.innerHTML;
            btnModalSave.disabled = true;
            btnModalSave.textContent = '저장 중...';

            const result = await saveConfigToServer(config);

            btnModalSave.disabled = false;
            btnModalSave.innerHTML = originalBtnHtml;

            closeModal();
            refreshAllSources(true);

            if (!result.ok) {
                alert(`서버 저장에 실패했습니다 (${result.message}).\n이 기기에만 임시로 저장된 상태이니, 다른 기기/새로고침 후에는 사라질 수 있습니다.`);
            }
        };

        async function refreshAllSources(forceRefresh = false) {
            if (!forceRefresh && window.__ALIVE_CACHE__.loaded && window.__ALIVE_CACHE__.channels.length > 0) {
                allChannels = window.__ALIVE_CACHE__.channels;
                epgData1 = window.__ALIVE_CACHE__.epgData1;
                epgData2 = window.__ALIVE_CACHE__.epgData2;
                channelHealth = window.__ALIVE_CACHE__.channelHealth;
                updateFilterSelects();
                applyFilter();
                
                if (isAutoResumeEnabled() && currentChannel) {
                    playChannel(currentChannel);
                } else if (!isAutoResumeEnabled()) {
                    resetToInitialUI();
                }
                return;
            }

            showLoading(true);
            allChannels = [];
            channelHealth = {};
            const sources = getSources();

            try {
                const results = await Promise.all(
                    sources.map((src) => src.url ? fetchAndParseM3U(src.url, src.name || '소스') : Promise.resolve([]))
                );

                allChannels = results.flat();
                window.__ALIVE_CACHE__.channels = allChannels;
                window.__ALIVE_CACHE__.loaded = true;

                if (allChannels.length === 0) {
                    if (videoOverlayMsg) {
                        videoOverlayMsg.textContent = '[소스 관리]에서 M3U 주소를 등록해 주세요.';
                        videoOverlayMsg.style.display = 'block';
                    }
                    channelCountBadge.textContent = '채널 0개';
                } else {
                    if (!currentChannel && videoOverlayMsg) {
                        videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
                        videoOverlayMsg.style.display = 'block';
                    }
                }

                updateFilterSelects();
                applyFilter();

                if (isAutoResumeEnabled()) {
                    const lastUrl = localStorage.getItem(LS.lastUrl);
                    if (lastUrl && !currentChannel) {
                        const found = allChannels.find(c => c.url === lastUrl);
                        if (found) playChannel(found);
                    }
                } else {
                    resetToInitialUI();
                }
            } catch (err) {
                console.error('[ALIVE Player] 로드 에러:', err);
            } finally {
                showLoading(false);
            }

            loadAllEPGs();
            setupEpgInterval();
        }

        btnRefreshAll.onclick = () => refreshAllSources(true);

        async function fetchAndParseM3U(rawUrl, sourceLabel) {
            try {
                const targetUrl = await resolveProxyUrl(rawUrl);
                const response = await fetch(targetUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const textData = await response.text();
                return parseM3U(textData, sourceLabel);
            } catch (e) {
                console.warn(`[ALIVE Player] ${sourceLabel} 로드 실패:`, e);
                if (videoOverlayMsg) {
                    videoOverlayMsg.textContent = `${sourceLabel} 로드 실패 (${e.message}). 주소를 확인해 주세요.`;
                    videoOverlayMsg.style.display = 'block';
                }
                return [];
            }
        }

        function parseM3U(content, sourceLabel) {
            const lines = content.split(/\r?\n/);
            const channels = [];
            let currentItem = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                if (line.startsWith('#EXTINF:')) {
                    currentItem = { source: sourceLabel };
                    const idMatch = line.match(/tvg-id="([^"]+)"/i);
                    currentItem.id = idMatch ? idMatch[1] : '';

                    const nameAttrMatch = line.match(/tvg-name="([^"]+)"/i);
                    currentItem.tvgName = nameAttrMatch ? nameAttrMatch[1] : '';

                    const groupMatch = line.match(/group-title="([^"]+)"/i);
                    currentItem.group = groupMatch ? groupMatch[1] : '기타';

                    const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
                    let rawLogo = (logoMatch ? logoMatch[1] : '').trim();
                    
                    if (rawLogo && rawLogo.toLowerCase() !== 'none' && (rawLogo.startsWith('http://') || rawLogo.startsWith('https://'))) {
                        currentItem.logo = rawLogo.replace(/^http:\/\//i, 'https://');
                    } else {
                        currentItem.logo = '';
                    }

                    const nameParts = line.split(',');
                    currentItem.name = nameParts.length > 1 ? nameParts.slice(1).join(',').trim() : (currentItem.tvgName || '이름 없는 채널');
                } else if (!line.startsWith('#') && currentItem) {
                    currentItem.url = line;
                    channels.push(currentItem);
                    currentItem = null;
                }
            }
            return channels;
        }

        async function loadAllEPGs() {
            const epg1 = localStorage.getItem(LS.epgUrl1) || '';
            const epg2 = localStorage.getItem(LS.epgUrl2) || '';

            if (!epg1 && !epg2) {
                return;
            }

            const p1 = epg1 ? fetchAndParseEPG(epg1) : Promise.resolve({});
            const p2 = epg2 ? fetchAndParseEPG(epg2) : Promise.resolve({});

            const [data1, data2] = await Promise.all([p1, p2]);
            epgData1 = data1;
            epgData2 = data2;

            window.__ALIVE_CACHE__.epgData1 = epgData1;
            window.__ALIVE_CACHE__.epgData2 = epgData2;

            renderChannelList();
            if (currentChannel) updateCurrentEpgDisplay(currentChannel);
        }

        async function fetchAndParseEPG(rawUrl) {
            try {
                const targetUrl = await resolveProxyUrl(rawUrl);
                const res = await fetch(targetUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const xmlText = await res.text();
                return parseXMLTV(xmlText);
            } catch (err) {
                console.warn('[ALIVE Player] EPG 가져오기 실패:', err);
                return {};
            }
        }

        function parseXMLTVDate(dateStr) {
            if (!dateStr) return new Date(0);
            const clean = dateStr.trim();
            const y = clean.substring(0, 4);
            const m = clean.substring(4, 6);
            const d = clean.substring(6, 8);
            const h = clean.substring(8, 10);
            const min = clean.substring(10, 12);
            const s = (clean.length >= 14 && !isNaN(clean.substring(12, 14))) ? clean.substring(12, 14) : '00';

            let tz = '+09:00';
            const tzMatch = clean.match(/([+-]\d{2})(\d{2})$/);
            if (tzMatch) tz = `${tzMatch[1]}:${tzMatch[2]}`;

            const iso = `${y}-${m}-${d}T${h}:${min}:${s}${tz}`;
            const parsed = new Date(iso);
            return isNaN(parsed.getTime()) ? new Date(0) : parsed;
        }

        function parseXMLTV(xmlStr) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
            
            const channelNodes = xmlDoc.getElementsByTagName('channel');
            const aliasMap = {}; 
            for (let i = 0; i < channelNodes.length; i++) {
                const cNode = channelNodes[i];
                const cId = cNode.getAttribute('id');
                if (!cId) continue;

                if (!aliasMap[cId]) aliasMap[cId] = [];
                aliasMap[cId].push(cId);
                aliasMap[cId].push(cleanChannelName(cId));
                
                const dispNames = cNode.getElementsByTagName('display-name');
                for (let j = 0; j < dispNames.length; j++) {
                    const dName = dispNames[j].textContent.trim();
                    if (dName) {
                        aliasMap[cId].push(dName);
                        aliasMap[cId].push(cleanChannelName(dName));
                    }
                }
            }

            const programmes = xmlDoc.getElementsByTagName('programme');
            const resultData = {};

            for (let i = 0; i < programmes.length; i++) {
                const prog = programmes[i];
                const channelAttr = prog.getAttribute('channel');
                const startStr = prog.getAttribute('start');
                const stopStr = prog.getAttribute('stop');
                const titleElem = prog.getElementsByTagName('title')[0];
                const title = titleElem ? titleElem.textContent.trim() : '제목 없음';

                if (channelAttr && startStr && stopStr) {
                    const item = {
                        start: parseXMLTVDate(startStr),
                        stop: parseXMLTVDate(stopStr),
                        title: title
                    };

                    if (!resultData[channelAttr]) resultData[channelAttr] = [];
                    resultData[channelAttr].push(item);

                    const cleanKey = cleanChannelName(channelAttr);
                    if (cleanKey && !resultData[cleanKey]) resultData[cleanKey] = resultData[channelAttr];

                    if (aliasMap[channelAttr]) {
                        aliasMap[channelAttr].forEach(alias => {
                            if (alias && !resultData[alias]) resultData[alias] = resultData[channelAttr];
                        });
                    }
                }
            }
            return resultData;
        }

        function getEpgInfo(channel) {
            const p1 = queryEpg(channel, epgData1);
            if (p1) return p1;
            return queryEpg(channel, epgData2);
        }

        function queryEpg(channel, dataMap) {
            if (!dataMap || Object.keys(dataMap).length === 0) return null;
            const candidateKeys = [
                channel.id,
                cleanChannelName(channel.id),
                channel.tvgName,
                cleanChannelName(channel.tvgName),
                channel.name,
                cleanChannelName(channel.name)
            ];

            let programList = null;
            for (const key of candidateKeys) {
                if (key && dataMap[key]) {
                    programList = dataMap[key];
                    break;
                }
            }

            if (!programList) {
                const targetClean = cleanChannelName(channel.name);
                // 방송 제목이 곧 채널명인 경우(예: "[LCK] GEN vs HLE | 승자조 3라운드...")는
                // 매번 문자열이 바뀌고 지나치게 길어서, 짧은 EPG 채널키가 우연히 그 안에
                // 포함되어 전혀 다른 프로그램과 오매칭되는 사고가 잦다. 이런 동적 제목형
                // 채널명은 부분일치 대상에서 아예 제외한다(정확히 일치하는 경우만 위에서
                // 이미 처리됨. 여기 안 걸리면 "편성 정보 없음"으로 두는 게 안전하다).
                const isDynamicTitleLike = targetClean.length > 24;

                if (targetClean && targetClean.length >= 3 && !isDynamicTitleLike) {
                    for (const epgKey of Object.keys(dataMap)) {
                        if (!epgKey || epgKey.length < 3) continue;
                        if (epgKey.includes(targetClean) || targetClean.includes(epgKey)) {
                            programList = dataMap[epgKey];
                            break;
                        }
                    }
                }
            }

            if (!programList || programList.length === 0) return null;
            const now = new Date();
            const nowIndex = programList.findIndex(p => now >= p.start && now <= p.stop);
            if (nowIndex === -1) return null;
            return {
                now: programList[nowIndex],
                next: programList[nowIndex + 1] || null,
            };
        }

        function setupEpgInterval() {
            if (epgTimer) clearInterval(epgTimer);
            const mins = parseInt(localStorage.getItem(LS.epgInterval) || '60', 10);
            if (mins > 0) {
                epgTimer = setInterval(() => {
                    loadAllEPGs();
                }, mins * 60 * 1000);
            }
        }

        btnCheckHealth.onclick = async () => {
            if (filteredChannels.length === 0) return;
            healthStatusBadge.style.display = 'inline-block';
            healthStatusBadge.textContent = '점검 중 (0%)';
            btnCheckHealth.disabled = true;

            // 이미 재생 중인 채널은 online이 자명하므로 점검 대상에서 제외 (동시접속 제한 회피)
            const queue = filteredChannels.filter(c => !currentChannel || c.url !== currentChannel.url);
            if (currentChannel) channelHealth[currentChannel.url] = 'online';

            const total = queue.length;
            let finished = 0;

            async function checkOne(url, timeoutMs) {
                async function attempt(targetUrl) {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const resp = await fetch(targetUrl, { method: 'GET', signal: controller.signal });
                        return (resp.ok || resp.status === 206);
                    } finally {
                        clearTimeout(timeoutId);
                    }
                }

                try {
                    // 재생 로직과 동일하게 원본 URL을 먼저 검사
                    const ok = await attempt(url);
                    if (ok) return true;
                } catch (e) {
                    // 원본 실패 시 프록시로 폴백 검사
                }
                const proxied = await resolveStreamUrl(url);
                return attempt(proxied);
            }

            const workers = Array(5).fill(null).map(async () => {
                while (queue.length > 0) {
                    const item = queue.shift();
                    channelHealth[item.url] = 'checking';
                    window.__ALIVE_CACHE__.channelHealth = channelHealth;
                    renderChannelList();

                    let ok = false;
                    try {
                        ok = await checkOne(item.url, 25000);
                    } catch (e) {
                        // 첫 시도 실패(진짜 타임아웃/일시적 거부) 시 1회 재시도
                        try {
                            ok = await checkOne(item.url, 25000);
                        } catch (e2) {
                            ok = false;
                        }
                    }
                    channelHealth[item.url] = ok ? 'online' : 'offline';

                    finished++;
                    window.__ALIVE_CACHE__.channelHealth = channelHealth;
                    healthStatusBadge.textContent = `점검 중 (${Math.round((finished / total) * 100)}%)`;
                    renderChannelList();
                }
            });

            await Promise.all(workers);
            healthStatusBadge.textContent = '점검 완료';
            healthStatusBadge.classList.add('cyan');
            btnCheckHealth.disabled = false;
        };

        function updateFilterSelects() {
            if (!groupSelect) return;
            const curGroup = groupSelect.value;
            const curSource = sourceSelect ? sourceSelect.value : 'ALL';

            // 그룹 목록은 "현재 선택된 소스"에 속한 채널만 기준으로 만든다
            const channelsForGroupList = (curSource === 'ALL')
                ? allChannels
                : allChannels.filter(c => (c.source || '기본') === curSource);
            const groups = Array.from(new Set(channelsForGroupList.map(c => c.group || '기타'))).sort();

            groupSelect.innerHTML = `
                <option value="ALL">전체 그룹</option>
                <option value="FAVORITES">⭐ 즐겨찾기 (${favorites.length})</option>
            `;

            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group;
                option.textContent = group;
                groupSelect.appendChild(option);
            });

            if (curGroup && (groups.includes(curGroup) || curGroup === 'FAVORITES')) {
                groupSelect.value = curGroup;
            }

            if (sourceSelect) {
                const sourceNames = Array.from(new Set(allChannels.map(c => c.source || '기본'))).sort();

                sourceSelect.innerHTML = `<option value="ALL">전체 소스</option>`;
                sourceNames.forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    sourceSelect.appendChild(option);
                });

                if (curSource && sourceNames.includes(curSource)) {
                    sourceSelect.value = curSource;
                }
            }
        }

        function applyFilter() {
            if (!groupSelect || !searchInput) return;
            const selectedGroup = groupSelect.value;
            const selectedSource = sourceSelect ? sourceSelect.value : 'ALL';
            const searchQuery = searchInput.value.toLowerCase().trim();

            filteredChannels = allChannels.filter(c => {
                let matchGroup = true;
                if (selectedGroup === 'FAVORITES') {
                    matchGroup = favorites.includes(c.name);
                } else if (selectedGroup !== 'ALL') {
                    matchGroup = (c.group === selectedGroup);
                }
                const matchSource = selectedSource === 'ALL' || (c.source || '기본') === selectedSource;
                const matchSearch = !searchQuery || (c.name && c.name.toLowerCase().includes(searchQuery));
                return matchGroup && matchSource && matchSearch;
            });

            channelCountBadge.textContent = `채널 ${filteredChannels.length}개`;
            renderChannelList();
        }

        function renderChannelList() {
            if (!channelList) return;
            channelList.innerHTML = '';

            filteredChannels.forEach((channel) => {
                const li = document.createElement('li');
                li.className = 'm3u-channel-item';
                if (currentChannel && currentChannel.url === channel.url) {
                    li.classList.add('active');
                }

                const favBtn = document.createElement('button');
                const isFav = favorites.includes(channel.name);
                favBtn.className = `channel-fav-btn ${isFav ? 'active' : ''}`;
                favBtn.innerHTML = isFav ? '<i class="fa-solid fa-star fas fa-star"></i>' : '<i class="fa-regular fa-star far fa-star"></i>';
                favBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleFavorite(channel);
                };

                const healthDot = document.createElement('span');
                const state = channelHealth[channel.url] || 'none';
                healthDot.className = `channel-health-dot ${state}`;
                li.appendChild(healthDot);

                if (channel.logo && channel.logo.startsWith('https://')) {
                    const img = document.createElement('img');
                    img.className = 'channel-logo';
                    img.src = channel.logo;
                    img.alt = '';
                    img.onerror = () => img.remove();
                    li.appendChild(img);
                }

                const details = document.createElement('div');
                details.className = 'channel-details';

                const nameDiv = document.createElement('div');
                nameDiv.className = 'channel-name';
                nameDiv.textContent = channel.name;

                const groupDiv = document.createElement('div');
                groupDiv.className = 'channel-group';
                groupDiv.textContent = `${channel.group} • ${channel.source || '기본'}`;

                details.appendChild(nameDiv);
                details.appendChild(groupDiv);

                const epgInfo = getEpgInfo(channel);
                if (epgInfo && epgInfo.now) {
                    const timeFormat = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    const epgDiv = document.createElement('div');
                    epgDiv.className = 'channel-epg-now';
                    epgDiv.textContent = `▶ ${epgInfo.now.title} (${timeFormat(epgInfo.now.start)}~)`;
                    details.appendChild(epgDiv);
                }

                li.appendChild(details);
                li.appendChild(favBtn);
                li.onclick = () => playChannel(channel);
                channelList.appendChild(li);
            });
        }

        function resolutionLabel(height) {
            if (!height) return null;
            if (height >= 2160) return '4K';
            if (height >= 1080) return 'FHD';
            if (height >= 720) return 'HD';
            if (height >= 480) return 'SD';
            return `${height}p`;
        }

        function updateResolutionBadge(height) {
            if (!currentResolutionBadge) return;
            const label = resolutionLabel(height);
            if (label) {
                currentResolutionBadge.textContent = label;
                currentResolutionBadge.style.display = 'inline-block';
            } else {
                currentResolutionBadge.style.display = 'none';
            }
        }

        function updateCurrentEpgDisplay(channel) {
            const epgInfo = getEpgInfo(channel);
            if (!currentEpgInfo) return;

            currentEpgInfo.textContent = '';
            const timeFormat = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

            if (epgInfo && epgInfo.now) {
                const nowDiv = document.createElement('div');
                nowDiv.className = 'epg-now';
                const strong = document.createElement('strong');
                strong.textContent = '현재 방송:';
                nowDiv.append(strong, ` ${epgInfo.now.title} (${timeFormat(epgInfo.now.start)} ~ ${timeFormat(epgInfo.now.stop)})`);
                currentEpgInfo.appendChild(nowDiv);

                if (epgInfo.next) {
                    const nextDiv = document.createElement('div');
                    nextDiv.className = 'epg-next';
                    const label = document.createElement('span');
                    label.className = 'epg-next-label';
                    label.textContent = '다음 방송:';
                    nextDiv.append(label, ` ${epgInfo.next.title} (${timeFormat(epgInfo.next.start)}~)`);
                    currentEpgInfo.appendChild(nextDiv);
                }
            } else {
                currentEpgInfo.textContent = '편성 정보 없음';
            }
        }

        function getHlsConfig(mode) {
            const baseConfig = {
                enableWorker: true,
                liveDurationInfinity: true,
                manifestLoadingTimeOut: 12000,
                manifestLoadingMaxRetry: 5,
                levelLoadingTimeOut: 12000,
                levelLoadingMaxRetry: 5,
                fragLoadingTimeOut: 18000,
                fragLoadingMaxRetry: 6,
            };

            if (mode === 'smooth') {
                return {
                    ...baseConfig,
                    lowLatencyMode: true,
                    backBufferLength: 20,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 8,
                    maxBufferHole: 0.5,
                    nudgeOffset: 0.1,
                    nudgeMaxRetry: 5,
                };
            } else if (mode === 'low_latency') {
                return {
                    ...baseConfig,
                    lowLatencyMode: true,
                    backBufferLength: 10,
                    maxBufferLength: 12,
                    maxMaxBufferLength: 24,
                    liveSyncDurationCount: 2,
                    liveMaxLatencyDurationCount: 5,
                    maxBufferHole: 0.3,
                    nudgeMaxRetry: 4,
                };
            } else {
                return {
                    ...baseConfig,
                    lowLatencyMode: true,
                    backBufferLength: 15,
                    maxBufferLength: 20,
                    maxMaxBufferLength: 40,
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 6,
                    maxBufferHole: 0.4,
                    nudgeMaxRetry: 5,
                };
            }
        }

        async function playChannel(channel) {
            if (!isElementVisible(container) && !isPipActive()) return;

            currentChannel = channel;
            window.__ALIVE_CACHE__.lastChannel = channel;
            localStorage.setItem(LS.lastUrl, channel.url);

            if (currentChannelName) currentChannelName.textContent = channel.name;
            if (currentChannelGroup) currentChannelGroup.textContent = `그룹: ${channel.group} (${channel.source || '기본'})`;
            if (videoOverlayMsg) {
                videoOverlayMsg.textContent = `${channel.name} 연결 중...`;
                videoOverlayMsg.style.display = 'block';
            }

            updateFavButtons();
            updateCurrentEpgDisplay(channel);
            renderChannelList();

            const hideConnectingOverlay = () => {
                if (videoOverlayMsg && videoOverlayMsg.style.display !== 'none') {
                    videoOverlayMsg.style.display = 'none';
                }
                if (channelHealth[channel.url] !== 'online') {
                    channelHealth[channel.url] = 'online';
                    window.__ALIVE_CACHE__.channelHealth = channelHealth;
                    renderChannelList();
                }
            };
            videoElement.addEventListener('playing', hideConnectingOverlay, { once: true });

            let usingProxyFallback = false;

            function startHlsPlayback(streamUrl) {
                if (window.Hls && Hls.isSupported()) {
                    stopPlayback();

                    const playbackMode = localStorage.getItem(LS.playbackMode) || 'smooth';
                    const hlsConfig = getHlsConfig(playbackMode);

                    hls = new Hls(hlsConfig);
                    hls.loadSource(streamUrl);
                    hls.attachMedia(videoElement);

                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (isElementVisible(container) || isPipActive()) {
                            videoElement.play().catch(() => {});
                        } else {
                            stopPlayback();
                        }
                    });

                    hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                        if (currentChannel !== channel) return;
                        const level = hls.levels && hls.levels[data.level];
                        updateResolutionBadge(level ? level.height : null);
                    });

                    hls.on(Hls.Events.ERROR, (event, data) => {
                        if (currentChannel !== channel) return;
                        if (data.fatal && (isElementVisible(container) || isPipActive())) {
                            const isEarlyLoadError = [
                                Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
                                Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
                                Hls.ErrorDetails.LEVEL_LOAD_ERROR,
                                Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT,
                            ].includes(data.details);

                            switch (data.type) {
                                case Hls.ErrorTypes.NETWORK_ERROR:
                                    if (isEarlyLoadError && !usingProxyFallback) {
                                        console.warn('[ALIVE] 원본 URL 재생 실패, 프록시 경유로 재시도...');
                                        usingProxyFallback = true;
                                        resolveStreamUrl(channel.url).then((proxiedUrl) => {
                                            if (currentChannel === channel) startHlsPlayback(proxiedUrl);
                                        });
                                        return;
                                    }
                                    console.warn('[ALIVE] 네트워크 지연 감지, 스트림 재연결...');
                                    hls.startLoad();
                                    break;
                                case Hls.ErrorTypes.MEDIA_ERROR:
                                    console.warn('[ALIVE] 미디어 버퍼 스톨 복구 시도...');
                                    hls.recoverMediaError();
                                    break;
                                default:
                                    console.error('[ALIVE] 스트림 fatal 오류:', data);
                                    stopPlayback();
                                    if (videoOverlayMsg) {
                                        videoOverlayMsg.textContent = '스트림이 일시 중단되었습니다. [재연결]을 눌러주세요.';
                                        videoOverlayMsg.style.display = 'block';
                                    }
                                    break;
                            }
                        }
                    });
                } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                    videoElement.src = streamUrl;
                    videoElement.addEventListener('loadedmetadata', () => {
                        if (isElementVisible(container) || isPipActive()) {
                            videoElement.play().catch(() => {});
                        } else {
                            stopPlayback();
                        }
                        updateResolutionBadge(videoElement.videoHeight);
                    }, { once: true });
                }
            }

            updateResolutionBadge(null);

            // 원본 채널 URL(무프록시)로 먼저 시도 — CORS를 여는 CDN이면 이게 더 빠르고 안정적
            startHlsPlayback(channel.url);
        }

        videoElement.addEventListener('waiting', () => {
            if (hls && !videoElement.paused && (isElementVisible(container) || isPipActive())) {
                hls.startLoad();
            }
        });

        if (btnReloadStream) {
            btnReloadStream.onclick = () => {
                if (currentChannel) playChannel(currentChannel);
            };
        }

        groupSelect.onchange = applyFilter;
        if (sourceSelect) {
            sourceSelect.onchange = () => {
                if (groupSelect) groupSelect.value = 'ALL';
                updateFilterSelects();
                applyFilter();
            };
        }
        searchInput.oninput = applyFilter;

        function showLoading(isLoading) {
            if (loadingSpinner) loadingSpinner.style.display = isLoading ? 'inline' : 'none';
        }

        function applyServerConfigToLocalStorage(config) {
            if (Array.isArray(config.sources)) {
                localStorage.setItem(LS.sources, JSON.stringify(config.sources));
            }
            if (typeof config.epgUrl1 === 'string') localStorage.setItem(LS.epgUrl1, config.epgUrl1);
            if (typeof config.epgUrl2 === 'string') localStorage.setItem(LS.epgUrl2, config.epgUrl2);
            if (config.epgInterval !== undefined && config.epgInterval !== null) {
                localStorage.setItem(LS.epgInterval, String(config.epgInterval));
            }
            if (typeof config.playbackMode === 'string') localStorage.setItem(LS.playbackMode, config.playbackMode);
            if (typeof config.autoResume === 'boolean') {
                localStorage.setItem(LS.autoResume, config.autoResume ? 'true' : 'false');
            }
        }

        (async () => {
            const serverConfig = await loadConfigFromServer();
            if (serverConfig) {
                applyServerConfigToLocalStorage(serverConfig);
            }
            loadFavorites();
            refreshAllSources(false);
        })();
    }

    ensureHlsLoaded(initM3UPlayer);
})();