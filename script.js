(function () {
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
        const container = document.querySelector('.m3u-container');
        const btnOpenSources = document.getElementById('btn-open-sources');
        const btnCheckHealth = document.getElementById('btn-check-health');
        const btnRefreshAll = document.getElementById('btn-refresh-all');

        const modalOverlay = document.getElementById('m3u-modal-overlay');
        const btnCloseModal = document.getElementById('btn-close-modal');
        const btnModalCancel = document.getElementById('btn-modal-cancel');
        const btnModalSave = document.getElementById('btn-modal-save');

        const cfgM3uUrl1 = document.getElementById('cfg-m3u-url1');
        const cfgM3uUrl2 = document.getElementById('cfg-m3u-url2');
        const cfgEpgUrl1 = document.getElementById('cfg-epg-url1');
        const cfgEpgUrl2 = document.getElementById('cfg-epg-url2');
        const cfgEpgInterval = document.getElementById('cfg-epg-interval');

        const groupSelect = document.getElementById('m3u-group-select');
        const searchInput = document.getElementById('m3u-search-input');
        const channelList = document.getElementById('m3u-channel-list');
        const channelCountBadge = document.getElementById('channel-count-badge');
        const epgStatusBadge = document.getElementById('epg-status-badge');
        const healthStatusBadge = document.getElementById('health-status-badge');
        const loadingSpinner = document.getElementById('loading-spinner');

        const videoElement = document.getElementById('video-element');
        const videoOverlayMsg = document.getElementById('video-overlay-msg');
        const btnFavCurrent = document.getElementById('btn-fav-current');
        const currentChannelName = document.getElementById('current-channel-name');
        const currentChannelGroup = document.getElementById('current-channel-group');
        const currentEpgInfo = document.getElementById('current-epg-info');
        const btnReloadStream = document.getElementById('btn-reload-stream');

        if (!btnOpenSources || !videoElement || !container) return;

        let allChannels = [];
        let filteredChannels = [];
        let epgData1 = {}; 
        let epgData2 = {}; 
        let channelHealth = {}; 
        let favorites = []; 
        let currentChannel = null;
        let hls = null;
        let epgTimer = null;
        let heartbeatTimer = null;

        // 실제 화면 노출 여부 검사 (부모의 display: none 까지 추적)
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

        // 스트림 및 오디오 완전 정지 루틴
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

        // 전체 정리 루틴 (메뉴 이탈/창 닫기)
        function cleanupAll() {
            stopPlayback();

            if (epgTimer) {
                clearInterval(epgTimer);
                epgTimer = null;
            }
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        }

        // 200ms 주기로 가시성 감시하여 다른 탭/메뉴 전환 시 오디오 즉각 차단
        heartbeatTimer = setInterval(() => {
            if (!isElementVisible(container)) {
                if (hls || (videoElement && !videoElement.paused)) {
                    stopPlayback();
                }
            }
        }, 200);

        // 사이드바 클릭, 뒤로가기, 탭 전환 시 강제 정지 이벤트 등록
        window.addEventListener('popstate', stopPlayback);
        window.addEventListener('hashchange', stopPlayback);
        window.addEventListener('beforeunload', cleanupAll);
        document.addEventListener('click', (e) => {
            const navTarget = e.target.closest('a, button, [data-category], [data-tab], .sidebar-item, .nav-link');
            if (navTarget && !container.contains(navTarget)) {
                setTimeout(() => {
                    if (!isElementVisible(container)) {
                        stopPlayback();
                    }
                }, 50);
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
                favorites = JSON.parse(localStorage.getItem('hoon_m3u_favorites') || '[]');
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
            localStorage.setItem('hoon_m3u_favorites', JSON.stringify(favorites));
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
                btnFavCurrent.innerHTML = '<i class="fa-regular fa-star"></i>';
                return;
            }
            const isFav = favorites.includes(currentChannel.name);
            btnFavCurrent.classList.toggle('active', isFav);
            btnFavCurrent.innerHTML = isFav ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
        }

        btnFavCurrent.onclick = () => {
            if (currentChannel) toggleFavorite(currentChannel);
        };

        function openModal() {
            cfgM3uUrl1.value = localStorage.getItem('hoon_m3u_url1') || '';
            cfgM3uUrl2.value = localStorage.getItem('hoon_m3u_url2') || '';
            cfgEpgUrl1.value = localStorage.getItem('hoon_epg_url1') || '';
            cfgEpgUrl2.value = localStorage.getItem('hoon_epg_url2') || '';
            cfgEpgInterval.value = localStorage.getItem('hoon_epg_interval') || '60';
            modalOverlay.style.display = 'flex';
        }

        function closeModal() {
            modalOverlay.style.display = 'none';
        }

        btnOpenSources.onclick = openModal;
        btnCloseModal.onclick = closeModal;
        btnModalCancel.onclick = closeModal;

        btnModalSave.onclick = () => {
            localStorage.setItem('hoon_m3u_url1', cfgM3uUrl1.value.trim());
            localStorage.setItem('hoon_m3u_url2', cfgM3uUrl2.value.trim());
            localStorage.setItem('hoon_epg_url1', cfgEpgUrl1.value.trim());
            localStorage.setItem('hoon_epg_url2', cfgEpgUrl2.value.trim());
            localStorage.setItem('hoon_epg_interval', cfgEpgInterval.value);
            closeModal();
            refreshAllSources();
        };

        async function refreshAllSources() {
            showLoading(true);
            allChannels = [];
            channelHealth = {};
            const url1 = localStorage.getItem('hoon_m3u_url1') || '';
            const url2 = localStorage.getItem('hoon_m3u_url2') || '';

            try {
                const p1 = url1 ? fetchAndParseM3U(url1, '소스1') : Promise.resolve([]);
                const p2 = url2 ? fetchAndParseM3U(url2, '소스2') : Promise.resolve([]);
                const [res1, res2] = await Promise.all([p1, p2]);

                allChannels = [...res1, ...res2];
                if (allChannels.length === 0) {
                    if (videoOverlayMsg) videoOverlayMsg.textContent = '[소스 관리]에서 M3U 주소를 등록해 주세요.';
                    channelCountBadge.textContent = '채널 0개';
                } else {
                    if (videoOverlayMsg) videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
                }

                updateGroupSelect();
                applyFilter();
            } catch (err) {
                console.error('[ALIVE Player] 로드 에러:', err);
            } finally {
                showLoading(false);
            }

            loadAllEPGs();
            setupEpgInterval();
        }

        btnRefreshAll.onclick = refreshAllSources;

        async function fetchAndParseM3U(rawUrl, sourceLabel) {
            try {
                const targetUrl = await resolveProxyUrl(rawUrl);
                const response = await fetch(targetUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const textData = await response.text();
                return parseM3U(textData, sourceLabel);
            } catch (e) {
                console.warn(`[ALIVE Player] ${sourceLabel} 로드 실패:`, e);
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
                    
                    // None 문자열 및 비정상 URL 완전 방어
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
            const epg1 = localStorage.getItem('hoon_epg_url1') || '';
            const epg2 = localStorage.getItem('hoon_epg_url2') || '';

            if (!epg1 && !epg2) {
                epgStatusBadge.textContent = 'EPG 미등록';
                epgStatusBadge.classList.remove('active');
                return;
            }

            epgStatusBadge.textContent = 'EPG 갱신 중...';
            const p1 = epg1 ? fetchAndParseEPG(epg1) : Promise.resolve({});
            const p2 = epg2 ? fetchAndParseEPG(epg2) : Promise.resolve({});

            const [data1, data2] = await Promise.all([p1, p2]);
            epgData1 = data1;
            epgData2 = data2;

            const total = Object.values(epgData1).reduce((s, a) => s + a.length, 0) + Object.values(epgData2).reduce((s, a) => s + a.length, 0);
            epgStatusBadge.textContent = `EPG 연동됨 (${total}개)`;
            epgStatusBadge.classList.add('active');

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

        function getNowProgram(channel) {
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
                if (targetClean) {
                    for (const epgKey of Object.keys(dataMap)) {
                        if (epgKey.includes(targetClean) || targetClean.includes(epgKey)) {
                            programList = dataMap[epgKey];
                            break;
                        }
                    }
                }
            }

            if (!programList || programList.length === 0) return null;
            const now = new Date();
            return programList.find(p => now >= p.start && now <= p.stop) || null;
        }

        function setupEpgInterval() {
            if (epgTimer) clearInterval(epgTimer);
            const mins = parseInt(localStorage.getItem('hoon_epg_interval') || '60', 10);
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

            const total = filteredChannels.length;
            let finished = 0;

            const queue = [...filteredChannels];
            const workers = Array(4).fill(null).map(async () => {
                while (queue.length > 0) {
                    const item = queue.shift();
                    channelHealth[item.url] = 'checking';
                    renderChannelList();

                    try {
                        const proxied = await resolveStreamUrl(item.url);
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 4000);
                        const resp = await fetch(proxied, { method: 'GET', signal: controller.signal });
                        clearTimeout(timeoutId);
                        channelHealth[item.url] = (resp.ok || resp.status === 206) ? 'online' : 'offline';
                    } catch (e) {
                        channelHealth[item.url] = 'offline';
                    }

                    finished++;
                    healthStatusBadge.textContent = `점검 중 (${Math.round((finished / total) * 100)}%)`;
                    renderChannelList();
                }
            });

            await Promise.all(workers);
            healthStatusBadge.textContent = '점검 완료';
            healthStatusBadge.classList.add('cyan');
            btnCheckHealth.disabled = false;
        };

        function updateGroupSelect() {
            if (!groupSelect) return;
            const cur = groupSelect.value;
            const groups = Array.from(new Set(allChannels.map(c => c.group || '기타'))).sort();
            
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

            if (cur && (groups.includes(cur) || cur === 'FAVORITES')) {
                groupSelect.value = cur;
            }
        }

        function applyFilter() {
            if (!groupSelect || !searchInput) return;
            const selectedGroup = groupSelect.value;
            const searchQuery = searchInput.value.toLowerCase().trim();

            filteredChannels = allChannels.filter(c => {
                let matchGroup = true;
                if (selectedGroup === 'FAVORITES') {
                    matchGroup = favorites.includes(c.name);
                } else if (selectedGroup !== 'ALL') {
                    matchGroup = (c.group === selectedGroup);
                }
                const matchSearch = !searchQuery || (c.name && c.name.toLowerCase().includes(searchQuery));
                return matchGroup && matchSearch;
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
                favBtn.innerHTML = isFav ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
                favBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleFavorite(channel);
                };
                li.appendChild(favBtn);

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

                const nowProg = getNowProgram(channel);
                if (nowProg) {
                    const timeFormat = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    const epgDiv = document.createElement('div');
                    epgDiv.className = 'channel-epg-now';
                    epgDiv.textContent = `▶ ${nowProg.title} (${timeFormat(nowProg.start)}~)`;
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

        async function playChannel(channel) {
            if (!isElementVisible(container)) return;

            currentChannel = channel;
            if (currentChannelName) currentChannelName.textContent = channel.name;
            if (currentChannelGroup) currentChannelGroup.textContent = `그룹: ${channel.group} (${channel.source || '기본'})`;
            if (videoOverlayMsg) videoOverlayMsg.style.display = 'none';

            updateFavButtons();
            updateCurrentEpgDisplay(channel);
            renderChannelList();

            const targetStreamUrl = await resolveStreamUrl(channel.url);

            if (window.Hls && Hls.isSupported()) {
                stopPlayback();

                hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 30,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 10,
                    manifestLoadingTimeOut: 10000,
                    manifestLoadingMaxRetry: 5,
                    levelLoadingTimeOut: 10000,
                    levelLoadingMaxRetry: 5,
                    fragLoadingTimeOut: 15000,
                    fragLoadingMaxRetry: 6,
                });

                hls.loadSource(targetStreamUrl);
                hls.attachMedia(videoElement);

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (isElementVisible(container)) {
                        videoElement.play().catch(() => {});
                    } else {
                        stopPlayback();
                    }
                });

                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal && isElementVisible(container)) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.warn('[ALIVE] 네트워크 지연 감지, 스트림 재연결...');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.warn('[ALIVE] 버퍼 스톨 감지, 자동 버퍼 복구...');
                                hls.recoverMediaError();
                                break;
                            default:
                                console.error('[ALIVE] 스트림 오류:', data);
                                stopPlayback();
                                if (videoOverlayMsg) {
                                    videoOverlayMsg.textContent = '스트림이 일시 중단되었습니다. 재연결을 시도하세요.';
                                    videoOverlayMsg.style.display = 'block';
                                }
                                break;
                        }
                    }
                });
            } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                videoElement.src = targetStreamUrl;
                videoElement.addEventListener('loadedmetadata', () => {
                    if (isElementVisible(container)) {
                        videoElement.play().catch(() => {});
                    } else {
                        stopPlayback();
                    }
                });
            }
        }

        videoElement.addEventListener('waiting', () => {
            if (hls && !videoElement.paused && isElementVisible(container)) {
                hls.startLoad();
            }
        });

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

        loadFavorites();
        refreshAllSources();
    }

    ensureHlsLoaded(initM3UPlayer);
})();
