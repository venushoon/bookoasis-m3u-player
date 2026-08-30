document.addEventListener('DOMContentLoaded', () => {
    const m3uUrlInput = document.getElementById('m3u-url-input');
    const btnLoadM3u = document.getElementById('btn-load-m3u');
    const groupSelect = document.getElementById('m3u-group-select');
    const searchInput = document.getElementById('m3u-search-input');
    const channelList = document.getElementById('m3u-channel-list');
    const channelCountBadge = document.getElementById('channel-count-badge');
    const loadingSpinner = document.getElementById('loading-spinner');

    const videoElement = document.getElementById('video-element');
    const videoOverlayMsg = document.getElementById('video-overlay-msg');
    const currentChannelName = document.getElementById('current-channel-name');
    const currentChannelGroup = document.getElementById('current-channel-group');
    const btnReloadStream = document.getElementById('btn-reload-stream');

    let allChannels = [];
    let filteredChannels = [];
    let currentChannel = null;
    let hls = null;

    // 로컬 스토리지에서 마지막 URL 불러오기
    const savedUrl = localStorage.getItem('bookoasis_m3u_last_url') || '';
    if (savedUrl) {
        m3uUrlInput.value = savedUrl;
        loadM3U(savedUrl);
    }

    // M3U 로드 버튼 이벤트
    btnLoadM3u.addEventListener('click', () => {
        const url = m3uUrlInput.value.trim();
        if (url) {
            localStorage.setItem('bookoasis_m3u_last_url', url);
            loadM3U(url);
        }
    });

    // M3U 파싱 함수
    async function loadM3U(url) {
        showLoading(true);
        videoOverlayMsg.textContent = 'M3U 목록을 불러오는 중입니다...';
        videoOverlayMsg.style.display = 'block';

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const textData = await response.text();
            allChannels = parseM3U(textData);

            updateGroupSelect();
            applyFilter();
            videoOverlayMsg.textContent = '재생할 채널을 선택해 주세요.';
        } catch (error) {
            console.error('[M3U Player] 로드 실패:', error);
            videoOverlayMsg.textContent = 'M3U 로드 실패. URL 또는 CORS 정책을 확인하세요.';
            channelCountBadge.textContent = '로드 실패';
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
                // group-title 파싱
                const groupMatch = line.match(/group-title="([^"]+)"/i);
                currentItem.group = groupMatch ? groupMatch[1] : '기타';

                // tvg-logo 파싱
                const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
                currentItem.logo = logoMatch ? logoMatch[1] : '';

                // 채널 이름 파싱
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
        const selectedGroup = groupSelect.value;
        const searchQuery = searchInput.value.toLowerCase().trim();

        filteredChannels = allChannels.filter(c => {
            const matchGroup = (selectedGroup === 'ALL') || (c.group === selectedGroup);
            const matchSearch = !searchQuery || (c.name && c.name.toLowerCase().includes(searchQuery));
            return matchGroup && matchSearch;
        });

        channelCountBadge.textContent = `채널 ${filteredChannels.length}개`;
        renderChannelList();
    }

    // XSS 방어: innerHTML 대신 DOM 생성 및 textContent 사용
    function renderChannelList() {
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

            li.addEventListener('click', () => {
                playChannel(channel);
            });

            channelList.appendChild(li);
        });
    }

    function playChannel(channel) {
        currentChannel = channel;
        currentChannelName.textContent = channel.name;
        currentChannelGroup.textContent = `그룹: ${channel.group}`;
        videoOverlayMsg.style.display = 'none';

        renderChannelList();

        const streamUrl = channel.url;
        if (Hls.isSupported()) {
            if (hls) {
                hls.destroy();
            }
            hls = new Hls({ enableWorker: true });
            hls.loadSource(streamUrl);
            hls.attachMedia(videoElement);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoElement.play().catch(() => {});
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('[HLS Error] 치명적 오류:', data);
                    videoOverlayMsg.textContent = '스트림 재생 오류가 발생했습니다.';
                    videoOverlayMsg.style.display = 'block';
                }
            });
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari 네이티브 HLS 지원
            videoElement.src = streamUrl;
            videoElement.addEventListener('loadedmetadata', () => {
                videoElement.play().catch(() => {});
            });
        } else {
            videoOverlayMsg.textContent = '브라우저가 HLS 스트리밍을 지원하지 않습니다.';
            videoOverlayMsg.style.display = 'block';
        }
    }

    btnReloadStream.addEventListener('click', () => {
        if (currentChannel) {
            playChannel(currentChannel);
        }
    });

    groupSelect.addEventListener('change', applyFilter);
    searchInput.addEventListener('input', applyFilter);

    function showLoading(isLoading) {
        loadingSpinner.style.display = isLoading ? 'inline' : 'none';
    }

    // BookOasis 대시보드 테마 변경 동적 감지
    const themeObserver = new MutationObserver(() => {
        // 테마 속성 변경 시 레이아웃 갱신
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });
});
