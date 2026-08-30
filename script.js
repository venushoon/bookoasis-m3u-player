(function () {
    const DEFAULT_PROXY_PRESET = 'https://api.allorigins.win/raw?url=';

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
        const btnToggleSettings = document.getElementById('btn-toggle-settings');
        const settingsPanel = document.getElementById('m3u-settings-panel');
        
        const epgUrlInput = document.getElementById('epg-url-input');
        const btnLoadEpg = document.getElementById('btn-load-epg');
        const corsProxyInput = document.getElementById('cors-proxy-input');
        const corsProxyCheck = document.getElementById('m3u-cors-proxy');
        const btnSaveDefaults = document.getElementById('btn-save-defaults');

        const groupSelect = document.getElementById('m3u-group-select');
        const searchInput = document.getElementById('m3u-search-input');
        const channelList = document.getElementById('m3u-channel-list');
        const channelCountBadge = document.getElementById('channel-count-badge');
        const epgStatusBadge = document.getElementById('epg-status-badge');
        const loadingSpinner = document.getElementById('loading-spinner');

        const videoElement = document.getElementById('video-element');
        const videoOverlayMsg = document.getElementById('video-overlay-msg');
        const currentChannelName = document.getElementById('current-channel-name');
        const currentChannelGroup = document.getElementById('current-channel-group');
        const currentEpgInfo = document.getElementById('current-epg-info');
        const btnReloadStream = document.getElementById('btn-reload-stream');

        if (!m3uUrlInput || !videoElement) return;

        let allChannels = [];
        let filteredChannels = [];
        let epgData = {};
        let currentChannel = null;
        let hls = null;

        btnToggleSettings.onclick = () => {
            const isHidden = settingsPanel.style.display === 'none';
            settingsPanel.style.display = isHidden ? 'flex' : 'none';
        };

        // 안전한 프록시 URL 생성 헬퍼
        function wrapProxy(url) {
            if (!corsProxyCheck || !corsProxyCheck.checked) {
                return url;
            }
            let proxyBase = (corsProxyInput.value || '').trim();
            if (!proxyBase) proxyBase = DEFAULT_PROXY_PRESET;

            if (proxyBase.includes('=')) {
                return proxyBase + encodeURIComponent(url);
            }
            return proxyBase.endsWith('/') ? proxyBase + url : proxyBase + '/' + url;
        }

        function loadSavedDefaults() {
            const savedM3u = localStorage.getItem('bookoasis_m3u_url') || '';
            const savedEpg = localStorage.getItem('bookoasis_epg_url') || '';
            const savedProxy = localStorage.getItem('bookoasis_cors_proxy') || '';
            const savedUseProxy = localStorage.getItem('bookoasis_use_proxy');

            if (savedM3u) m3uUrlInput.value = savedM3u;
            if (savedEpg) epgUrlInput.value = savedEpg;
            if (savedProxy) corsProxyInput.value = savedProxy;
            
            // 기본값은 프록시 해제(false)로 안전하게 초기화
            if (savedUseProxy !== null) {
                corsProxyCheck.checked = (savedUseProxy === 'true');
            } else {
                corsProxyCheck.checked = false;
            }

            if (savedM3u) loadM3U(savedM3u);
            if (savedEpg) loadEPG(savedEpg);
        }

        btnSaveDefaults.onclick = () => {
            localStorage.setItem('bookoasis_m3u_url', m3uUrlInput.value.trim());
            localStorage.setItem('bookoasis_epg_url', epgUrlInput.value.trim());
            localStorage.setItem('bookoasis_cors_proxy', corsProxyInput.value.trim());
            localStorage.setItem('bookoasis_use_proxy', corsProxyCheck.checked ? 'true' : 'false');
            alert('M3U, EPG 및 프록시 설정이 브라우저에 저장되었습니다.');
        };

        btnLoadM3u.onclick = () => {
            const url = m3uUrlInput.value.trim();
            if (url) loadM3U(url);
        };

        btnLoadEpg.onclick = () => {
            const url = epgUrlInput.value.trim();
            if (url) loadEPG(url);
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

                if (allChannels.length === 0) throw new Error('유효한 채널이 없습니다.');

                updateGroupSelect();
                applyFilter();
                if (videoOverlayMsg) videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
            } catch (error) {
                console.error('[M3U Player] M3U 로드 실패:', error);
                if (videoOverlayMsg) {
                    videoOverlayMsg.textContent = 'M3U 로드 실패: 주소 및 프록시 체크 여부를 확인하세요.';
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
                    const idMatch = line.match(/tvg-id="([^"]+)"/i);
                    currentItem.id = idMatch ? idMatch[1] : '';

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

        async function loadEPG(rawUrl) {
            epgStatusBadge.textContent = 'EPG 로딩 중...';
            try {
                const targetUrl = wrapProxy(rawUrl);
                const res = await fetch(targetUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const xmlText = await res.text();
                parseXMLTV(xmlText);
                epgStatusBadge.textContent = 'EPG 연동됨';
                epgStatusBadge.classList.add('active');
                renderChannelList();
                if (currentChannel) updateCurrentEpgDisplay(currentChannel);
            } catch (err) {
                console.warn('[M3U Player] EPG 로드 실패:', err);
                epgStatusBadge.textContent = 'EPG 미등록';
                epgStatusBadge.classList.remove('active');
            }
        }

        function parseXMLTV(xmlStr) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
            const programmes = xmlDoc.getElementsByTagName('programme');
            epgData = {};

            for (let i = 0; i < programmes.length; i++) {
                const prog = programmes[i];
                const channel = prog.getAttribute('channel');
                const startStr = prog.getAttribute('start');
                const stopStr = prog.getAttribute('stop');
                const titleElem = prog.getElementsByTagName('title')[0];
                const title = titleElem ? titleElem.textContent : '제목 없음';

                if (channel && startStr && stopStr) {
                    if (!epgData[channel]) epgData[channel] = [];
                    epgData[channel].push({
                        start: parseXMLTVDate(startStr),
                        stop: parseXMLTVDate(stopStr),
                        title: title
                    });
                }
            }
        }

        function parseXMLTVDate(dateStr) {
            const raw = dateStr.split(' ')[0];
            const y = raw.substring(0, 4);
            const m = raw.substring(4, 6) - 1;
            const d = raw.substring(6, 8);
            const h = raw.substring(8, 10);
            const min = raw.substring(10, 12);
            const s = raw.substring(12, 14) || '00';
            return new Date(Date.UTC(y, m, d, h - 9, min, s));
        }

        function getNowProgram(channel) {
            const list = epgData[channel.id] || epgData[channel.name];
            if (!list || list.length === 0) return null;
            const now = new Date();
            return list.find(p => now >= p.start && now <= p.stop) || null;
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

                const nowProg = getNowProgram(channel);
                if (nowProg) {
                    const epgDiv = document.createElement('div');
                    epgDiv.className = 'channel-epg-now';
                    epgDiv.textContent = `▶ ${nowProg.title}`;
                    details.appendChild(epgDiv);
                }

                li.appendChild(details);
                li.onclick = () => playChannel(channel);
                channelList.appendChild(li);
            });
        }

        function updateCurrentEpgDisplay(channel) {
            const nowProg = getNowProgram(channel);
            if (currentEpgInfo) {
                if (nowProg) {
                    const timeFormat = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    currentEpgInfo.innerHTML = `<strong>현재 방송:</strong> ${nowProg.title} (${timeFormat(nowProg.start)} ~ ${timeFormat(nowProg.stop)})`;
                } else {
                    currentEpgInfo.textContent = '편성 정보 없음';
                }
            }
        }

        function playChannel(channel) {
            currentChannel = channel;
            if (currentChannelName) currentChannelName.textContent = channel.name;
            if (currentChannelGroup) currentChannelGroup.textContent = `그룹: ${channel.group}`;
            if (videoOverlayMsg) videoOverlayMsg.style.display = 'none';

            updateCurrentEpgDisplay(channel);
            renderChannelList();

            const streamUrl = channel.url;
            const useProxy = corsProxyCheck && corsProxyCheck.checked;
            let proxyBase = (corsProxyInput.value || '').trim();
            if (!proxyBase) proxyBase = DEFAULT_PROXY_PRESET;

            if (window.Hls && Hls.isSupported()) {
                if (hls) hls.destroy();

                const hlsConfig = { enableWorker: true };
                if (useProxy) {
                    hlsConfig.xhrSetup = function (xhr, url) {
                        if (!url.startsWith(proxyBase) && url.startsWith('http')) {
                            const proxiedUrl = proxyBase.includes('=') ? proxyBase + encodeURIComponent(url) : (proxyBase.endsWith('/') ? proxyBase + url : proxyBase + '/' + url);
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
                        videoOverlayMsg.textContent = '스트림 재생 오류가 발생했습니다.';
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

        groupSelect.onchange = applyFilter;
        searchInput.oninput = applyFilter;

        function showLoading(isLoading) {
            if (loadingSpinner) loadingSpinner.style.display = isLoading ? 'inline' : 'none';
        }

        loadSavedDefaults();
    }

    ensureHlsLoaded(initM3UPlayer);
})();
