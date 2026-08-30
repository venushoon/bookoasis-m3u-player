(function () {
    const CORS_PROXY = 'https://corsproxy.io/?';

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

    function initM3UPlayer() {
        const m3uUrlInput = document.getElementById('m3u-url-input');
        const btnLoadM3u = document.getElementById('btn-load-m3u');
        const groupSelect = document.getElementById('m3u-group-select');
        const searchInput = document.getElementById('m3u-search-input');
        const corsProxyCheck = document.getElementById('m3u-cors-proxy');
        const channelList = document.getElementById('m3u-channel-list');
        const channelCountBadge = document.getElementById('channel-count-badge');
        const loadingSpinner = document.getElementById('loading-spinner');

        const videoElement = document.getElementById('video-element');
        const videoOverlayMsg = document.getElementById('video-overlay-msg');
        const currentChannelName = document.getElementById('current-channel-name');
        const currentChannelGroup = document.getElementById('current-channel-group');
        const btnReloadStream = document.getElementById('btn-reload-stream');

        if (!m3uUrlInput || !videoElement) return;

        let allChannels = [];
        let filteredChannels = [];
        let currentChannel = null;
        let hls = null;

        // 프록시 URL 변환 헬퍼
        function wrapProxy(url) {
            if (corsProxyCheck && corsProxyCheck.checked) {
                return CORS_PROXY + encodeURIComponent(url);
            }
            return url;
        }

        const savedUrl = localStorage.getItem('bookoasis_m3u_last_url') || '';
        if (savedUrl) {
            m3uUrlInput.value = savedUrl;
            loadM3U(savedUrl);
        }

        btnLoadM3u.onclick = () => {
            const url = m3uUrlInput.value.trim();
            if (url) {
                localStorage.setItem('bookoasis_m3u_last_url', url);
                loadM3U(url);
            }
        };

        m3uUrlInput.onkeydown = (e) => {
            if (e.key === 'Enter') btnLoadM3u.click();
        };

        async function loadM3U(rawUrl) {
            showLoading(true);
            if (videoOverlayMsg) {
                videoOverlayMsg.textContent = 'M3U 목록을 불러오는 중입니다...';
                videoOverlayMsg.style.display = 'block';
            }

            try {
                const targetUrl = wrapProxy(rawUrl);
                const response = await fetch(targetUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status} (${response.statusText})`);
                const textData = await response.text();
                allChannels = parseM3U(textData);

                if (allChannels.length === 0) throw new Error('유효한 채널 목록이 없습니다.');

                updateGroupSelect();
                applyFilter();

                if (videoOverlayMsg) videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
            } catch (error) {
                console.error('[M3U Player] 로드 실패:', error);
                if (videoOverlayMsg) {
                    videoOverlayMsg.textContent = 'M3U 로드 실패: CORS 프록시 체크 상태 또는 URL을 확인하세요.';
                    videoOverlayMsg.style.display = 'block';
                }
                if (channelCountBadge) channelCountBadge.textContent = '로드 실패';
            } finally {
                showLoading(false);
            }
        }

        function parseM3U(content) {
            const lines = content.split(/\r?\n/);
            const channels = [];
            let currentItem = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                if (line.startsWith('#EXTINF:')) {
                    currentItem = {};
                    const groupMatch = line.match(/group-title="([^"]+)"/i);
                    currentItem.group = groupMatch ? groupMatch[1] : '기타';

                    const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
                    currentItem.logo = logoMatch ? logoMatch[1] : '';

                    const nameParts = line.split(',');
                    currentItem.name = nameParts.length > 1 ? nameParts.slice(1).join(',').trim() : '이름 없는 채널';
                } else if (!line.startsWith('#') && currentItem) {
                    currentItem.url = line;
                    channels.push(currentItem);
                    currentItem = null;
                }
            }
            return channels;
        }

        function updateGroupSelect() {
            if (!groupSelect) return;
            const groups = Array.from(new Set(allChannels.map(c => c.group || '기타'))).sort();
            groupSelect.innerHTML = '<option value="ALL">전체 그룹</option>';
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group;
                option.textContent = group;
                groupSelect.appendChild(option);
            });
        }

        function applyFilter() {
            if (!groupSelect || !searchInput) return;
            const selectedGroup = groupSelect.value;
            const searchQuery = searchInput.value.toLowerCase().trim();

            filteredChannels = allChannels.filter(c => {
                const matchGroup = (selectedGroup === 'ALL') || (c.group === selectedGroup);
                const matchSearch = !searchQuery || (c.name && c.name.toLowerCase().includes(searchQuery));
                return matchGroup && matchSearch;
            });

            if (channelCountBadge) channelCountBadge.textContent = `채널 ${filteredChannels.length}개`;
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

                if (channel.logo) {
                    const img = document.createElement('img');
                    img.className = 'channel-logo';
                    img.src = channel.logo;
                    img.alt = '';
                    img.onerror = () => { img.style.display = 'none'; };
                    li.appendChild(img);
                }

                const details = document.createElement('div');
                details.className = 'channel-details';

                const nameDiv = document.createElement('div');
                nameDiv.className = 'channel-name';
                nameDiv.textContent = channel.name;

                const groupDiv = document.createElement('div');
                groupDiv.className = 'channel-group';
                groupDiv.textContent = channel.group;

                details.appendChild(nameDiv);
                details.appendChild(groupDiv);
                li.appendChild(details);

                li.onclick = () => playChannel(channel);
                channelList.appendChild(li);
            });
        }

        function playChannel(channel) {
            currentChannel = channel;
            if (currentChannelName) currentChannelName.textContent = channel.name;
            if (currentChannelGroup) currentChannelGroup.textContent = `그룹: ${channel.group}`;
            if (videoOverlayMsg) videoOverlayMsg.style.display = 'none';

            renderChannelList();

            const streamUrl = channel.url;
            const useProxy = corsProxyCheck && corsProxyCheck.checked;

            if (window.Hls && Hls.isSupported()) {
                if (hls) hls.destroy();

                const hlsConfig = {
                    enableWorker: true,
                };

                // CORS 프록시 모드일 때 세그먼트 요청 주소 자동 래핑
                if (useProxy) {
                    hlsConfig.xhrSetup = function (xhr, url) {
                        // 상대경로가 아닌 전체 URL 요청일 때 프록시 래핑
                        if (!url.startsWith(CORS_PROXY) && url.startsWith('http')) {
                            const proxiedUrl = CORS_PROXY + encodeURIComponent(url);
                            xhr.open('GET', proxiedUrl, true);
                        }
                    };
                }

                hls = new Hls(hlsConfig);
                const targetStreamUrl = useProxy ? wrapProxy(streamUrl) : streamUrl;
                hls.loadSource(targetStreamUrl);
                hls.attachMedia(videoElement);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    videoElement.play().catch(() => {});
                });
                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal && videoOverlayMsg) {
                        videoOverlayMsg.textContent = '스트림 재생 오류: CORS 정책 또는 비활성 링크입니다.';
                        videoOverlayMsg.style.display = 'block';
                    }
                });
            } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                videoElement.src = useProxy ? wrapProxy(streamUrl) : streamUrl;
                videoElement.addEventListener('loadedmetadata', () => {
                    videoElement.play().catch(() => {});
                });
            }
        }

        if (btnReloadStream) {
            btnReloadStream.onclick = () => {
                if (currentChannel) playChannel(currentChannel);
            };
        }

        if (groupSelect) groupSelect.onchange = applyFilter;
        if (searchInput) searchInput.oninput = applyFilter;

        function showLoading(isLoading) {
            if (loadingSpinner) loadingSpinner.style.display = isLoading ? 'inline' : 'none';
        }
    }

    ensureHlsLoaded(initM3UPlayer);
})();
