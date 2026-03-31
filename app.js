// =============================================
// DRIVE AUDIO PLAYER - Main Application
// =============================================

let tokenClient;
let accessToken = null;
let currentFolderId = null;
let folderHistory = [];
let audioFiles = [];
let currentIndex = 0;
let currentSpeed = 1;
let isPublicMode = false; // Flag for public access mode (no login)

const audio = document.getElementById('audioPlayer');

// =============================================
// INITIALIZATION
// =============================================

window.onload = function () {
    // Load saved state
    loadSavedState();

    // Load theme
    loadTheme();

    // Initialize Google API
    gapi.load('client', initializeGapiClient);
};

// =============================================
// THEME AND SETTINGS
// =============================================
function loadTheme() {
    const savedTheme = localStorage.getItem('drive_theme');
    const themeBtn = document.getElementById('themeToggleBtn');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        if (themeBtn) themeBtn.innerHTML = '🌙 Tối';
    } else {
        document.body.classList.remove('light-mode');
        if (themeBtn) themeBtn.innerHTML = '☀️ Sáng';
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    const themeBtn = document.getElementById('themeToggleBtn');
    if (isLight) {
        localStorage.setItem('drive_theme', 'light');
        if (themeBtn) themeBtn.innerHTML = '🌙 Tối';
    } else {
        localStorage.setItem('drive_theme', 'dark');
        if (themeBtn) themeBtn.innerHTML = '☀️ Sáng';
    }
}

// =============================================
// SLEEP TIMER
// =============================================
let sleepTimerInterval = null;
let sleepTimerTimeout = null;
let sleepTimerEndTime = 0;

function setSleepTimer() {
    const select = document.getElementById('sleepTimerSelect');
    const countdownEl = document.getElementById('sleepTimerCountdown');
    const val = select.value;

    // Clear existing
    if (sleepTimerInterval) clearInterval(sleepTimerInterval);
    if (sleepTimerTimeout) clearTimeout(sleepTimerTimeout);
    
    if (val === '0') {
        countdownEl.classList.add('hidden');
        return;
    }

    if (val === 'end_of_chapter') {
        countdownEl.classList.remove('hidden');
        countdownEl.textContent = '(Hết chương)';
        return; // Will be handled by audio 'ended' event
    }

    // Minutes to MS
    const ms = parseInt(val) * 60 * 1000;
    sleepTimerEndTime = Date.now() + ms;
    
    countdownEl.classList.remove('hidden');
    
    // Update countdown text every second
    sleepTimerInterval = setInterval(() => {
        const diff = sleepTimerEndTime - Date.now();
        if (diff <= 0) {
            clearInterval(sleepTimerInterval);
        } else {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            countdownEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }
    }, 1000);

    // Stop audio triggered
    sleepTimerTimeout = setTimeout(() => {
        audio.pause();
        select.value = '0';
        countdownEl.classList.add('hidden');
        clearInterval(sleepTimerInterval);
        alert('Đã hết thời gian hẹn giờ đi ngủ!');
    }, ms);
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: CONFIG.API_KEY,
            discoveryDocs: CONFIG.DISCOVERY_DOCS,
        });

        // Initialize Google Identity Services
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: CONFIG.SCOPES,
            callback: handleAuthCallback,
        });

        // Check if already signed in (authenticated mode)
        const savedToken = localStorage.getItem('drive_access_token');
        if (savedToken) {
            accessToken = savedToken;
            gapi.client.setToken({ access_token: savedToken });
            showMainApp();
            return;
        }

        // Check for saved public folder (public mode - no login)
        const savedPublicFolder = localStorage.getItem('drive_public_folder');
        if (savedPublicFolder) {
            // Auto restore public mode
            isPublicMode = true;
            accessToken = null;

            // Hide user info (not logged in)
            document.getElementById('userInfo').classList.add('hidden');

            // Show public mode indicator
            showPublicModeIndicator();

            // Enter app with saved folder as root
            folderHistory = [{ id: savedPublicFolder, name: 'Shared Folder' }];
            showMainApp();
            loadFolder(savedPublicFolder);
        }
    } catch (error) {
        console.error('Error initializing Google API:', error);
    }
}

// =============================================
// AUTHENTICATION
// =============================================

let tokenExpiryTime = null;
let tokenRefreshInterval = null;

function handleSignIn() {
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleAuthCallback(response) {
    if (response.error) {
        console.error('Auth error:', response.error);
        return;
    }

    accessToken = response.access_token;
    localStorage.setItem('drive_access_token', accessToken);
    gapi.client.setToken({ access_token: accessToken });

    // Lưu thời gian hết hạn (thường là 1 giờ, ta refresh sau 45 phút)
    tokenExpiryTime = Date.now() + (45 * 60 * 1000);
    localStorage.setItem('drive_token_expiry', tokenExpiryTime);

    // Thiết lập auto refresh
    setupTokenRefresh();

    // Xóa thanh refresh nếu có
    const refreshBar = document.getElementById('refreshBar');
    if (refreshBar) refreshBar.remove();

    // Kiểm tra xem có cần resume không
    const needResume = localStorage.getItem('drive_need_resume');
    if (needResume) {
        localStorage.removeItem('drive_need_resume');
        // Resume playback
        resumeAfterRelogin();
    } else {
        // Get user info và show main app
        fetchUserInfo();
        showMainApp();
    }
}

function setupTokenRefresh() {
    // Xóa interval cũ nếu có
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
    }

    // Kiểm tra token mỗi 5 phút
    tokenRefreshInterval = setInterval(() => {
        const expiry = parseInt(localStorage.getItem('drive_token_expiry') || 0);
        if (Date.now() > expiry) {
            console.log('Token hết hạn, đang refresh...');
            silentTokenRefresh();
        }
    }, 5 * 60 * 1000);
}

// Refresh token ngầm không cần user interaction
function silentTokenRefresh() {
    return new Promise((resolve, reject) => {
        tokenClient.requestAccessToken({ prompt: '' });
        // Callback sẽ được gọi trong handleAuthCallback
        setTimeout(() => {
            if (accessToken) {
                resolve(accessToken);
            } else {
                reject(new Error('Token refresh failed'));
            }
        }, 3000);
    });
}

// Wrapper để fetch với auto retry khi token hết hạn
async function fetchWithAuth(url, options = {}) {
    const headers = {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`
    };

    let response = await fetch(url, { ...options, headers });

    // Nếu 401, hiện nút refresh login
    if (response.status === 401) {
        console.log('Token expired');
        showRefreshLoginButton();
        throw new Error('TOKEN_EXPIRED');
    }

    return response;
}

// Hiện nút refresh login (không mất trạng thái)
function showRefreshLoginButton() {
    // Tạm dừng audio
    audio.pause();

    // Hiện thông báo
    let refreshBar = document.getElementById('refreshBar');
    if (!refreshBar) {
        refreshBar = document.createElement('div');
        refreshBar.id = 'refreshBar';
        refreshBar.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
            background: #ef4444; color: white; padding: 12px 20px;
            display: flex; justify-content: space-between; align-items: center;
            font-size: 14px;
        `;
        refreshBar.innerHTML = `
            <span>⚠️ Phiên đăng nhập hết hạn</span>
            <button onclick="refreshLogin()" style="
                background: white; color: #ef4444; border: none;
                padding: 8px 16px; border-radius: 6px; font-weight: bold;
                cursor: pointer;
            ">Đăng nhập lại</button>
        `;
        document.body.prepend(refreshBar);
    }
}

// Đăng nhập lại (giữ nguyên trạng thái)
function refreshLogin() {
    // Lưu trạng thái hiện tại
    saveState();

    // Đánh dấu cần resume sau khi đăng nhập
    localStorage.setItem('drive_need_resume', 'true');

    // Xóa thanh thông báo
    const refreshBar = document.getElementById('refreshBar');
    if (refreshBar) refreshBar.remove();

    // Yêu cầu đăng nhập lại (có popup)
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignOut() {
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
    }
    accessToken = null;
    isPublicMode = false;
    localStorage.removeItem('drive_access_token');
    localStorage.removeItem('drive_token_expiry');
    localStorage.removeItem('drive_user');
    localStorage.removeItem('drive_need_resume');
    localStorage.removeItem('drive_public_folder');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('userInfo').classList.add('hidden');

    // Xóa thanh refresh nếu có
    const refreshBar = document.getElementById('refreshBar');
    if (refreshBar) refreshBar.remove();
}

// =============================================
// PUBLIC ACCESS MODE (No Login Required)
// =============================================

function handlePublicAccess() {
    const urlInput = document.getElementById('publicFolderUrl');
    const url = urlInput.value.trim();

    if (!url) {
        alert('Vui lòng nhập link folder Google Drive!');
        return;
    }

    // Extract folder ID from various Google Drive URL formats
    let folderId = null;

    // Format: https://drive.google.com/drive/folders/FOLDER_ID
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
        folderId = folderMatch[1];
    }

    // Format: https://drive.google.com/drive/u/0/folders/FOLDER_ID
    if (!folderId) {
        const folderMatch2 = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (folderMatch2) folderId = folderMatch2[1];
    }

    // Direct folder ID (no URL, just the ID)
    if (!folderId && /^[a-zA-Z0-9_-]{20,}$/.test(url)) {
        folderId = url;
    }

    if (!folderId) {
        alert('Không thể nhận diện link folder. Vui lòng kiểm tra lại!\n\nVí dụ: https://drive.google.com/drive/folders/abc123...');
        return;
    }

    // Save for future visits
    localStorage.setItem('drive_public_folder', folderId);

    // Set public mode flag
    isPublicMode = true;
    accessToken = null;

    // Hide user info (not logged in)
    document.getElementById('userInfo').classList.add('hidden');

    // Show public mode indicator
    showPublicModeIndicator();

    // Enter app with this folder as root
    folderHistory = [{ id: folderId, name: 'Shared Folder' }];
    showMainApp();
    loadFolder(folderId);
}

function showPublicModeIndicator() {
    // Thay vì tạo banner to chiếm chỗ, ta nhúng thẳng vào Header (vị trí User Info)
    const userInfo = document.getElementById('userInfo');
    const avatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const btnBox = document.querySelector('#userInfo button');
    
    if(avatar) avatar.style.display = 'none';
    if(userName) {
        userName.innerHTML = '<span style="color:var(--primary-color, #10b981); font-weight:bold; font-size:13px;">🌐 <span class="hide-mobile">Chế độ </span>Công khai</span>';
    }
    if(btnBox) {
        btnBox.textContent = 'Đổi chế độ';
    }
    
    if(userInfo) {
        userInfo.classList.remove('hidden');
    }
}

async function fetchUserInfo() {
    try {
        const response = await fetchWithAuth('https://www.googleapis.com/oauth2/v2/userinfo');
        const user = await response.json();

        document.getElementById('userAvatar').src = user.picture;
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userInfo').classList.remove('hidden');

        localStorage.setItem('drive_user', JSON.stringify(user));
    } catch (error) {
        console.error('Error fetching user info:', error);
    }
}

// =============================================
// MAIN APP
// =============================================

async function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    // Load saved user (only for authenticated mode)
    if (!isPublicMode) {
        const savedUser = localStorage.getItem('drive_user');
        if (savedUser) {
            const user = JSON.parse(savedUser);
            document.getElementById('userAvatar').src = user.picture;
            document.getElementById('userName').textContent = user.name;
            document.getElementById('userInfo').classList.remove('hidden');
        } else {
            fetchUserInfo();
        }
    }

    // Render viewing history
    renderHistory();

    // Thử khôi phục tiến trình đã lưu (only if not coming from public access)
    if (!isPublicMode) {
        const hasSavedState = localStorage.getItem('drive_player_state');
        if (hasSavedState) {
            await restorePlaybackState();
        } else {
            // Nếu không có, tìm folder gốc
            await findRootFolder();
        }
    }
}

async function findRootFolder() {
    showLoading();

    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${CONFIG.ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const folders = response.result.files;

        if (folders && folders.length > 0) {
            currentFolderId = folders[0].id;
            folderHistory = [{ id: currentFolderId, name: CONFIG.ROOT_FOLDER_NAME }];
            await loadFolder(currentFolderId);
        } else {
            showError(`Không tìm thấy folder "${CONFIG.ROOT_FOLDER_NAME}" trên Drive`);
        }
    } catch (error) {
        console.error('Error finding root folder:', error);
        handleApiError(error);
    }
}

async function loadFolder(folderId) {
    showLoading();
    currentFolderId = folderId;

    try {
        let allFiles = [];
        let pageToken = null;

        // Fetch all pages
        do {
            let response;

            if (isPublicMode) {
                // Public mode: use API key directly (no OAuth)
                const params = new URLSearchParams({
                    q: `'${folderId}' in parents and trashed=false`,
                    fields: 'nextPageToken, files(id, name, mimeType, size)',
                    pageSize: 1000,
                    key: CONFIG.API_KEY
                });
                if (pageToken) params.append('pageToken', pageToken);

                const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error?.message || 'Failed to load folder');
                }
                response = { result: await res.json() };
            } else {
                // Authenticated mode: use gapi client
                response = await gapi.client.drive.files.list({
                    q: `'${folderId}' in parents and trashed=false`,
                    fields: 'nextPageToken, files(id, name, mimeType, size)',
                    pageSize: 1000,
                    pageToken: pageToken
                });
            }

            const files = response.result.files || [];
            allFiles = allFiles.concat(files);
            pageToken = response.result.nextPageToken;

            // Update loading message
            if (pageToken) {
                document.getElementById('folderList').innerHTML =
                    `<div class="loading">Đang tải... (${allFiles.length} files)</div>`;
            }
        } while (pageToken);

        // Sort files naturally (1, 2, 10, 100 instead of 1, 10, 100, 2)
        allFiles.sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });

        renderFolderContents(allFiles);
        updateBreadcrumb();
    } catch (error) {
        console.error('Error loading folder:', error);
        handleApiError(error);
    }
}

function renderFolderContents(files) {
    const container = document.getElementById('folderList');

    if (files.length === 0) {
        container.innerHTML = '<div class="loading">Folder trống</div>';
        return;
    }

    // Separate folders and audio files
    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const audios = files.filter(f => f.mimeType.startsWith('audio/') || f.name.endsWith('.mp3'));

    // Check if this is a story folder (has 'chapters' and/or 'audio' subfolders)
    const chaptersFolder = folders.find(f => f.name.toLowerCase() === 'chapters');
    const audioFolder = folders.find(f => f.name.toLowerCase() === 'audio');
    const isStoryFolder = chaptersFolder || audioFolder;

    let html = '';

    if (isStoryFolder) {
        // This is a story folder - show action buttons instead of subfolders
        const storyName = folderHistory.length > 1
            ? folderHistory[folderHistory.length - 1].name
            : 'Truyện';

        html += `<div style="text-align: center; padding: 20px 0;">`;
        html += `<h3 style="margin-bottom: 15px; font-size: 18px;">${escapeHtml(storyName)}</h3>`;
        html += `<div class="story-actions" style="border-top: none; justify-content: center; gap: 12px; display: flex; flex-wrap: wrap;">`;

        if (chaptersFolder) {
            html += `<button class="btn-reader" onclick="openReaderMode('${chaptersFolder.id}')" style="font-size: 16px; padding: 14px 28px;">📖 Đọc Truyện</button>`;
        }
        if (audioFolder) {
            html += `<button class="btn-reader btn-audio" onclick="openFolder('${audioFolder.id}', 'audio')" style="font-size: 16px; padding: 14px 28px;">🎵 Nghe Audio</button>`;
        }

        html += `</div></div>`;

        // Scroll to top so buttons are visible
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);

        // Also show other folders/files if any
        const otherFolders = folders.filter(f => f.name.toLowerCase() !== 'chapters' && f.name.toLowerCase() !== 'audio');
        otherFolders.forEach(folder => {
            html += `
                <div class="folder-item" onclick="openFolder('${folder.id}', '${escapeHtml(folder.name)}')">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${escapeHtml(folder.name)}</span>
                    <span class="folder-meta">→</span>
                </div>
            `;
        });
    } else {
        // Normal folder - render as before
        folders.forEach(folder => {
            html += `
                <div class="folder-item" onclick="openFolder('${folder.id}', '${escapeHtml(folder.name)}')">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${escapeHtml(folder.name)}</span>
                    <span class="folder-meta">→</span>
                </div>
            `;
        });
    }

    // Render audio files
    audios.forEach((file, index) => {
        const size = file.size ? formatSize(file.size) : '';
        html += `
            <div class="folder-item audio" onclick="playAudioFolder(${index})">
                <span class="folder-icon">🎵</span>
                <span class="folder-name">${escapeHtml(file.name)}</span>
                <span class="folder-meta">${size}</span>
            </div>
        `;
    });

    container.innerHTML = html;

    // If there are audio files, prepare playlist
    if (audios.length > 0) {
        audioFiles = audios.map((f, i) => ({
            id: f.id,
            name: f.name.replace('.mp3', ''),
            index: i
        }));
    } else {
        audioFiles = [];
    }
}

function openFolder(folderId, folderName) {
    folderHistory.push({ id: folderId, name: folderName });
    loadFolder(folderId);
}

function goBack() {
    if (folderHistory.length > 1) {
        folderHistory.pop();
        const prev = folderHistory[folderHistory.length - 1];
        loadFolder(prev.id);
    }
}

function updateBreadcrumb() {
    const path = folderHistory.map(f => f.name).join(' / ');
    document.getElementById('currentPath').textContent = path;

    const backBtn = document.getElementById('backBtn');
    if (folderHistory.length > 1) {
        backBtn.classList.remove('hidden');
    } else {
        backBtn.classList.add('hidden');
    }
}

// =============================================
// AUDIO PLAYER
// =============================================

function playAudioFolder(startIndex = 0) {
    if (audioFiles.length === 0) return;

    // Show player and chapter list
    document.getElementById('playerCard').classList.remove('hidden');
    document.getElementById('chapterListCard').classList.remove('hidden');

    // Set story name
    const storyName = folderHistory.length > 1
        ? folderHistory[folderHistory.length - 1].name
        : 'Unknown';
    document.getElementById('storyName').textContent = storyName;

    // Render chapter list
    renderChapterList();

    // Play
    playChapter(startIndex);
}

function renderChapterList() {
    const container = document.getElementById('chapterList');
    const total = audioFiles.length;

    container.innerHTML = audioFiles.map((file, i) => `
        <div class="chapter-item" id="chapter-${i}" onclick="playChapter(${i})">
            <span>${escapeHtml(file.name)}</span>
            <span class="chapter-num">${i + 1}/${total}</span>
        </div>
    `).join('');
}

async function playChapter(index) {
    if (index < 0 || index >= audioFiles.length) return;

    currentIndex = index;
    const file = audioFiles[index];

    // Update UI
    document.querySelectorAll('.chapter-item').forEach(el => el.classList.remove('playing'));
    document.getElementById(`chapter-${index}`).classList.add('playing');
    document.getElementById('chapterTitle').textContent = file.name;
    document.getElementById('progressText').textContent = `${index + 1} / ${audioFiles.length}`;

    // Get audio URL and play
    try {
        let blobUrl;

        // Sử dụng blob đã pre-fetch nếu có
        if (file.blobUrl) {
            blobUrl = file.blobUrl;
        } else {
            let response;

            if (isPublicMode) {
                // Public mode: use API key directly
                const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${CONFIG.API_KEY}`;
                response = await fetch(url);
            } else {
                // Authenticated mode: use fetchWithAuth
                const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
                response = await fetchWithAuth(url);
            }

            if (!response.ok) throw new Error('Failed to fetch audio');

            const blob = await response.blob();
            blobUrl = URL.createObjectURL(blob);
        }

        audio.src = blobUrl;
        audio.playbackRate = currentSpeed;
        audio.play();

        // Scroll to chapter
        document.getElementById(`chapter-${index}`).scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });

        // Save state
        saveState();
    } catch (error) {
        console.error('Error playing audio:', error);
        alert('Không thể phát audio. Vui lòng thử lại.');
    }
}

function playNext() {
    if (currentIndex < audioFiles.length - 1) {
        playChapter(currentIndex + 1);
    }
}

function playPrev() {
    if (currentIndex > 0) {
        playChapter(currentIndex - 1);
    }
}

function setSpeed(speed) {
    currentSpeed = speed;
    audio.playbackRate = speed;

    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === speed + 'x');
    });

    localStorage.setItem('drive_speed', speed);
}

// Auto next
audio.addEventListener('ended', () => {
    // Check if sleep timer is set to 'end_of_chapter'
    const select = document.getElementById('sleepTimerSelect');
    if (select && select.value === 'end_of_chapter') {
        // Reset timer and DO NOT play next
        select.value = '0';
        document.getElementById('sleepTimerCountdown').classList.add('hidden');
        return;
    }

    if (document.getElementById('autoNext').checked) {
        playNext();
    }
});

// =============================================
// MEDIA SESSION API (iOS Lock Screen Support)
// =============================================

function updateMediaSession() {
    if ('mediaSession' in navigator) {
        const currentFile = audioFiles[currentIndex];
        const storyName = folderHistory.length > 1
            ? folderHistory[folderHistory.length - 1].name
            : 'Audio';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentFile ? currentFile.name : 'Unknown',
            artist: storyName,
            album: `Chương ${currentIndex + 1}/${audioFiles.length}`
        });

        // Đăng ký các action handlers
        navigator.mediaSession.setActionHandler('play', () => {
            audio.play();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            audio.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            playPrev();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            playNext();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + (details.seekOffset || 10));
        });
    }
}

// Cập nhật Media Session khi phát chương mới
audio.addEventListener('play', updateMediaSession);

// Pre-load chương tiếp theo khi gần hết chương hiện tại
audio.addEventListener('timeupdate', () => {
    // Khi còn 10 giây, chuẩn bị sẵn chương tiếp
    if (audio.duration && (audio.duration - audio.currentTime) < 10) {
        const nextIndex = currentIndex + 1;
        if (nextIndex < audioFiles.length && document.getElementById('autoNext').checked) {
            // Pre-fetch next chapter
            const nextFile = audioFiles[nextIndex];
            if (!nextFile.prefetched) {
                nextFile.prefetched = true; // Đánh dấu ngay để tránh fetch trùng

                const fetchUrl = isPublicMode
                    ? `https://www.googleapis.com/drive/v3/files/${nextFile.id}?alt=media&key=${CONFIG.API_KEY}`
                    : `https://www.googleapis.com/drive/v3/files/${nextFile.id}?alt=media`;

                const fetchFn = isPublicMode ? fetch(fetchUrl) : fetchWithAuth(fetchUrl);

                fetchFn
                    .then(response => response.blob())
                    .then(blob => {
                        nextFile.blobUrl = URL.createObjectURL(blob);
                    })
                    .catch(() => {
                        nextFile.prefetched = false; // Cho phép thử lại nếu lỗi
                    });
            }
        }
    }
});

// =============================================
// HELPERS
// =============================================

function showLoading() {
    document.getElementById('folderList').innerHTML = '<div class="loading">Đang tải...</div>';
}

function showError(message) {
    document.getElementById('folderList').innerHTML = `<div class="loading">${message}</div>`;
}

function handleApiError(error) {
    if (error.status === 401) {
        // Token expired, re-authenticate
        localStorage.removeItem('drive_access_token');
        handleSignIn();
    } else {
        showError('Lỗi: ' + (error.message || 'Không xác định'));
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function saveState() {
    const state = {
        folderHistory,
        currentFolderId,
        currentIndex,
        audioTime: audio.currentTime || 0,
        audioFileIds: audioFiles.map(f => f.id),
        audioFileNames: audioFiles.map(f => f.name)
    };
    localStorage.setItem('drive_player_state', JSON.stringify(state));

    // Also save to viewing history (per story)
    if (currentFolderId && audioFiles.length > 0) {
        saveToHistory(currentFolderId, {
            folderHistory,
            currentIndex,
            audioTime: audio.currentTime || 0,
            totalChapters: audioFiles.length,
            currentChapterName: audioFiles[currentIndex]?.name || '',
            lastAccessed: Date.now()
        });
    }
}

// =============================================
// VIEWING HISTORY (Per Story)
// =============================================

function getHistory() {
    try {
        const history = localStorage.getItem('drive_viewing_history');
        return history ? JSON.parse(history) : {};
    } catch {
        return {};
    }
}

function saveToHistory(folderId, data) {
    const history = getHistory();
    const storyName = data.folderHistory?.length > 1
        ? data.folderHistory[data.folderHistory.length - 1].name
        : 'Unknown';

    history[folderId] = {
        ...data,
        storyName,
        folderId
    };

    // Keep only last 50 stories
    const entries = Object.entries(history);
    if (entries.length > 50) {
        entries.sort((a, b) => b[1].lastAccessed - a[1].lastAccessed);
        const trimmed = Object.fromEntries(entries.slice(0, 50));
        localStorage.setItem('drive_viewing_history', JSON.stringify(trimmed));
    } else {
        localStorage.setItem('drive_viewing_history', JSON.stringify(history));
    }
}

function getStoryProgress(folderId) {
    const history = getHistory();
    return history[folderId] || null;
}

function renderHistory() {
    const history = getHistory();
    const entries = Object.values(history);

    if (entries.length === 0) {
        document.getElementById('historyCard').classList.add('hidden');
        return;
    }

    // Sort by last accessed (newest first)
    entries.sort((a, b) => b.lastAccessed - a.lastAccessed);

    const container = document.getElementById('historyList');
    container.innerHTML = entries.slice(0, 10).map(item => {
        const icon = item.isReader ? '📖' : '🎵';
        const chapterIdx = item.isReader ? (item.chapterIndex || 0) : (item.currentIndex || 0);
        const chapterName = item.isReader ? item.chapterName : item.currentChapterName;
        const resumeFunc = item.isReader
            ? `resumeReaderFromHistory('${item.folderId}')`
            : `resumeFromHistory('${item.folderId}')`;

        return `
        <div class="history-item" onclick="${resumeFunc}">
            <div class="history-info">
                <div class="history-name">${icon} ${escapeHtml(item.storyName)}</div>
                <div class="history-progress">
                    Chương ${chapterIdx + 1}/${item.totalChapters} 
                    ${chapterName ? '- ' + escapeHtml(chapterName.substring(0, 30)) : ''}
                </div>
            </div>
            <div class="history-time">${timeAgo(item.lastAccessed)}</div>
            <button class="btn-resume" onclick="event.stopPropagation(); ${resumeFunc}">
                ▶️ Tiếp tục
            </button>
        </div>`;
    }).join('');

    document.getElementById('historyCard').classList.remove('hidden');
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Vừa xong';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' phút trước';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' giờ trước';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' ngày trước';
    return Math.floor(seconds / 604800) + ' tuần trước';
}

async function resumeFromHistory(folderId) {
    const item = getStoryProgress(folderId);
    if (!item) return;

    try {
        // Restore folder history
        folderHistory = item.folderHistory || [{ id: folderId, name: item.storyName }];
        currentFolderId = folderId;

        // Load folder
        await loadFolder(folderId);

        // Start playing from saved position
        if (audioFiles.length > 0) {
            document.getElementById('playerCard').classList.remove('hidden');
            document.getElementById('chapterListCard').classList.remove('hidden');
            document.getElementById('storyName').textContent = item.storyName;

            renderChapterList();

            const savedIndex = Math.min(item.currentIndex || 0, audioFiles.length - 1);
            await playChapter(savedIndex);

            // Resume audio position
            if (item.audioTime && item.audioTime > 0) {
                audio.currentTime = item.audioTime;
            }
        }
    } catch (error) {
        console.error('Error resuming from history:', error);
        alert('Không thể tiếp tục. Vui lòng thử lại.');
    }
}

function toggleHistoryCard() {
    const card = document.getElementById('historyCard');
    const list = document.getElementById('historyList');
    if (list.style.display === 'none') {
        list.style.display = '';
    } else {
        list.style.display = 'none';
    }
}

function loadSavedState() {
    const savedSpeed = localStorage.getItem('drive_speed');
    if (savedSpeed) {
        currentSpeed = parseFloat(savedSpeed);
    }
}

// Khôi phục tiến trình sau khi đăng nhập
async function restorePlaybackState() {
    const savedState = localStorage.getItem('drive_player_state');
    if (!savedState) return;

    try {
        const state = JSON.parse(savedState);

        if (state.folderHistory && state.folderHistory.length > 0) {
            folderHistory = state.folderHistory;
            currentFolderId = state.currentFolderId;

            // Load folder
            await loadFolder(currentFolderId);

            // Nếu có audio files đã lưu, khôi phục playlist
            if (state.audioFileIds && state.audioFileIds.length > 0 && audioFiles.length > 0) {
                // Show player
                document.getElementById('playerCard').classList.remove('hidden');
                document.getElementById('chapterListCard').classList.remove('hidden');

                const storyName = folderHistory.length > 1
                    ? folderHistory[folderHistory.length - 1].name
                    : 'Unknown';
                document.getElementById('storyName').textContent = storyName;

                renderChapterList();

                // Resume chapter
                const savedIndex = state.currentIndex || 0;
                if (savedIndex < audioFiles.length) {
                    await playChapter(savedIndex);

                    // Resume audio position
                    if (state.audioTime && state.audioTime > 0) {
                        audio.currentTime = state.audioTime;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error restoring state:', error);
    }
}

// Lưu vị trí audio định kỳ (mỗi 5 giây)
setInterval(() => {
    if (audio && !audio.paused && audioFiles.length > 0) {
        saveState();
    }
}, 5000);

// Lưu khi pause hoặc chuyển chương
audio.addEventListener('pause', saveState);
audio.addEventListener('ended', saveState);

// Resume sau khi đăng nhập lại (khi token hết hạn)
async function resumeAfterRelogin() {
    console.log('Resuming after re-login...');

    const savedState = localStorage.getItem('drive_player_state');
    if (!savedState) {
        showMainApp();
        return;
    }

    try {
        const state = JSON.parse(savedState);

        // Khôi phục folder history
        if (state.folderHistory) {
            folderHistory = state.folderHistory;
            currentFolderId = state.currentFolderId;
        }

        // Show main app
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');

        // Fetch lại audio file hiện tại
        const currentFileId = state.audioFileIds[state.currentIndex];
        const currentFileName = state.audioFileNames[state.currentIndex];

        if (currentFileId) {
            // Tải và phát lại file hiện tại
            const url = `https://www.googleapis.com/drive/v3/files/${currentFileId}?alt=media`;
            const response = await fetchWithAuth(url);

            if (response.ok) {
                const blob = await response.blob();
                audio.src = URL.createObjectURL(blob);
                audio.currentTime = state.audioTime || 0;
                audio.playbackRate = currentSpeed;
                audio.play();

                // Cập nhật UI
                document.getElementById('playerCard').classList.remove('hidden');
                document.getElementById('chapterTitle').textContent = currentFileName;
                document.getElementById('progressText').textContent =
                    `${state.currentIndex + 1} / ${state.audioFileIds.length}`;

                console.log('Playback resumed successfully!');
            }
        }

        // Load lại folder và danh sách (background)
        loadFolder(currentFolderId);

    } catch (error) {
        console.error('Error resuming:', error);
        showMainApp();
    }
}

// =============================================
// READER MODE
// =============================================

let readerChapters = []; // [{id, name, number}, ...]
let readerCurrentIndex = 0;
let readerChaptersFolderId = null;
let readerStoryName = '';

async function openReaderMode(chaptersFolderId) {
    readerChaptersFolderId = chaptersFolderId;
    readerStoryName = folderHistory.length > 1
        ? folderHistory[folderHistory.length - 1].name
        : 'Truyện';

    document.getElementById('readerStoryName').textContent = readerStoryName;

    // Show reader UI, hide folder browser
    document.getElementById('folderBrowser').classList.add('hidden');
    document.getElementById('historyCard').classList.add('hidden');
    document.getElementById('playerCard').classList.add('hidden');
    document.getElementById('chapterListCard').classList.add('hidden');
    document.getElementById('readerCard').classList.remove('hidden');
    document.getElementById('readerChapterListCard').classList.remove('hidden');
    document.getElementById('readerContent').innerHTML = '<div class="loading">Đang tải danh sách chương...</div>';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Load chapters from Drive
    try {
        // Try to load index.json from parent story folder for chapter titles
        let chapterTitlesMap = {};
        try {
            const storyFolderId = currentFolderId; // parent of chapters folder
            let indexFile = null;

            // Find index.json in the story folder
            if (isPublicMode) {
                const params = new URLSearchParams({
                    q: `'${storyFolderId}' in parents and name='index.json' and trashed=false`,
                    fields: 'files(id)',
                    key: CONFIG.API_KEY
                });
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
                if (res.ok) {
                    const data = await res.json();
                    indexFile = data.files?.[0];
                }
            } else {
                const resp = await gapi.client.drive.files.list({
                    q: `'${storyFolderId}' in parents and name='index.json' and trashed=false`,
                    fields: 'files(id)'
                });
                indexFile = resp.result.files?.[0];
            }

            if (indexFile) {
                let indexRes;
                if (isPublicMode) {
                    indexRes = await fetch(`https://www.googleapis.com/drive/v3/files/${indexFile.id}?alt=media&key=${CONFIG.API_KEY}`);
                } else {
                    indexRes = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${indexFile.id}?alt=media`);
                }
                if (indexRes.ok) {
                    const indexData = await indexRes.json();
                    if (indexData.chapters && Array.isArray(indexData.chapters)) {
                        indexData.chapters.forEach(ch => {
                            chapterTitlesMap[ch.number] = ch.title;
                        });
                    }
                }
            }
        } catch (e) {
            console.log('index.json not available, using filenames:', e);
        }

        let allFiles = [];
        let pageToken = null;

        do {
            let response;
            if (isPublicMode) {
                const params = new URLSearchParams({
                    q: `'${chaptersFolderId}' in parents and trashed=false`,
                    fields: 'nextPageToken, files(id, name, size)',
                    pageSize: 1000,
                    key: CONFIG.API_KEY
                });
                if (pageToken) params.append('pageToken', pageToken);
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
                if (!res.ok) throw new Error('Failed to load chapters');
                response = { result: await res.json() };
            } else {
                response = await gapi.client.drive.files.list({
                    q: `'${chaptersFolderId}' in parents and trashed=false`,
                    fields: 'nextPageToken, files(id, name, size)',
                    pageSize: 1000,
                    pageToken: pageToken
                });
            }
            allFiles = allFiles.concat(response.result.files || []);
            pageToken = response.result.nextPageToken;
        } while (pageToken);

        // Filter JSON files and sort naturally
        readerChapters = allFiles
            .filter(f => f.name.endsWith('.json'))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            .map((f, i) => {
                const num = parseInt(f.name.replace('.json', ''));
                const title = chapterTitlesMap[num] || f.name.replace('.json', '').replace(/^chapter_\d+_/, '');
                return {
                    id: f.id,
                    name: title,
                    fullName: f.name,
                    index: i
                };
            });

        if (readerChapters.length === 0) {
            document.getElementById('readerContent').innerHTML = '<div class="loading">Không tìm thấy chương nào</div>';
            return;
        }

        // Render chapter list
        renderReaderChapterList();

        // Check for saved progress
        const saved = getReaderProgress(chaptersFolderId);
        const startIndex = saved ? Math.min(saved.chapterIndex, readerChapters.length - 1) : 0;

        // Load first chapter
        await loadReaderChapter(startIndex);

        // Init TTS voices
        initTtsVoices();

    } catch (error) {
        console.error('Error loading chapters:', error);
        document.getElementById('readerContent').innerHTML =
            '<div class="loading">Lỗi tải chương. Vui lòng thử lại.</div>';
    }
}

function renderReaderChapterList() {
    const container = document.getElementById('readerChapterList');
    const total = readerChapters.length;

    container.innerHTML = readerChapters.map((ch, i) => `
        <div class="chapter-item" id="reader-chapter-${i}" onclick="loadReaderChapter(${i})">
            <span>${escapeHtml(ch.name)}</span>
            <span class="chapter-num">${i + 1}/${total}</span>
        </div>
    `).join('');
}

async function loadReaderChapter(index) {
    if (index < 0 || index >= readerChapters.length) {
        // End of story
        if (index >= readerChapters.length) {
            document.getElementById('readerContent').innerHTML =
                '<div class="loading">🎉 Đã đọc hết truyện!</div>';
        }
        return;
    }

    // Stop TTS if playing
    ttsStop();

    readerCurrentIndex = index;
    const chapter = readerChapters[index];

    // Update UI
    document.getElementById('readerChapterTitle').textContent =
        `${chapter.name} (${index + 1}/${readerChapters.length})`;
    document.getElementById('readerContent').innerHTML = '<div class="loading">Đang tải...</div>';

    // Highlight in chapter list
    document.querySelectorAll('#readerChapterList .chapter-item').forEach(el => el.classList.remove('playing'));
    const chapterEl = document.getElementById(`reader-chapter-${index}`);
    if (chapterEl) {
        chapterEl.classList.add('playing');
        chapterEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    try {
        let response;
        if (isPublicMode) {
            const url = `https://www.googleapis.com/drive/v3/files/${chapter.id}?alt=media&key=${CONFIG.API_KEY}`;
            response = await fetch(url);
        } else {
            const url = `https://www.googleapis.com/drive/v3/files/${chapter.id}?alt=media`;
            response = await fetchWithAuth(url);
        }

        if (!response.ok) throw new Error('Failed to fetch chapter');

        const data = await response.json();

        // Update chapter title from JSON if available
        if (data.title) {
            document.getElementById('readerChapterTitle').textContent =
                `${data.title} (${index + 1}/${readerChapters.length})`;
        }

        // Extract content from JSON - content can be array or string
        let paragraphs = [];
        if (Array.isArray(data.content)) {
            // Content is array of strings (StoryDownloader format)
            paragraphs = data.content.filter(p => p && p.trim());
        } else if (typeof data.content === 'string') {
            paragraphs = data.content.split('\n').filter(p => p.trim());
        } else if (typeof data.text === 'string') {
            paragraphs = data.text.split('\n').filter(p => p.trim());
        } else if (Array.isArray(data.text)) {
            paragraphs = data.text.filter(p => p && p.trim());
        } else if (typeof data === 'string') {
            paragraphs = data.split('\n').filter(p => p.trim());
        }

        // Render content as paragraphs
        const html = paragraphs.map((p, i) =>
            `<p data-para="${i}">${escapeHtml(p.trim())}</p>`
        ).join('');

        document.getElementById('readerContent').innerHTML = html || '<p>Chương trống</p>';

        // Scroll to top
        document.getElementById('readerContent').scrollTop = 0;
        window.scrollTo({ top: document.getElementById('readerCard').offsetTop - 20, behavior: 'smooth' });

        // Save progress
        saveReaderProgress();

    } catch (error) {
        console.error('Error loading chapter:', error);
        document.getElementById('readerContent').innerHTML =
            '<div class="loading">Lỗi tải chương. Vui lòng thử lại.</div>';
    }
}

function readerNextChapter() {
    loadReaderChapter(readerCurrentIndex + 1);
}

function readerPrevChapter() {
    loadReaderChapter(readerCurrentIndex - 1);
}

function closeReader() {
    ttsStop();
    document.getElementById('readerCard').classList.add('hidden');
    document.getElementById('readerChapterListCard').classList.add('hidden');
    document.getElementById('folderBrowser').classList.remove('hidden');
    document.getElementById('historyCard').classList.remove('hidden');
}

// =============================================
// READER PROGRESS (per story)
// =============================================

function saveReaderProgress() {
    if (!readerChaptersFolderId) return;
    const history = getHistory();
    const key = `reader_${readerChaptersFolderId}`;
    history[key] = {
        storyName: readerStoryName,
        chapterIndex: readerCurrentIndex,
        chapterName: readerChapters[readerCurrentIndex]?.name || '',
        totalChapters: readerChapters.length,
        lastAccessed: Date.now(),
        folderId: readerChaptersFolderId,
        folderHistory: folderHistory,
        isReader: true
    };
    localStorage.setItem('drive_viewing_history', JSON.stringify(history));
}

function getReaderProgress(folderId) {
    const history = getHistory();
    return history[`reader_${folderId}`] || null;
}

async function resumeReaderFromHistory(folderId) {
    const item = getReaderProgress(folderId);
    if (!item) return;

    try {
        // Restore folder history
        folderHistory = item.folderHistory || [{ id: folderId, name: item.storyName }];
        currentFolderId = folderId;

        // Show main app
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');

        // Open reader mode
        await openReaderMode(folderId);
    } catch (error) {
        console.error('Error resuming reader:', error);
        alert('Không thể tiếp tục đọc. Vui lòng thử lại.');
    }
}

// =============================================
// TTS (Text-to-Speech)
// =============================================

const synth = window.speechSynthesis;
let ttsPlaying = false;
let ttsCurrentPara = 0;
let ttsUtterance = null;
let ttsKeepAliveAudio = null;

// Silent audio keepalive - prevents iOS/Android from suspending TTS when screen off
function ttsStartKeepAlive() {
    try {
        if (ttsKeepAliveAudio) return;

        // Create a tiny silent WAV (44 bytes header + minimal data)
        // This is a valid 1-second silent WAV at 8kHz mono 8-bit
        const sampleRate = 8000;
        const duration = 1;
        const numSamples = sampleRate * duration;
        const buffer = new ArrayBuffer(44 + numSamples);
        const view = new DataView(buffer);

        // WAV header
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + numSamples, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate, true); // byte rate
        view.setUint16(32, 1, true); // block align
        view.setUint16(34, 8, true); // bits per sample
        writeStr(36, 'data');
        view.setUint32(40, numSamples, true);

        // Fill with silence (128 = silence in 8-bit unsigned PCM)
        for (let i = 0; i < numSamples; i++) {
            view.setUint8(44 + i, 128);
        }

        const blob = new Blob([buffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        ttsKeepAliveAudio = new Audio(url);
        ttsKeepAliveAudio.loop = true;
        ttsKeepAliveAudio.volume = 0.01; // Nearly silent
        ttsKeepAliveAudio.play().catch(e => console.log('Keepalive audio failed:', e));

        // Set Media Session to keep lock screen controls active
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        console.log('TTS keepalive audio started');
    } catch (e) {
        console.log('Keepalive audio error:', e);
    }
}

function ttsStopKeepAlive() {
    if (ttsKeepAliveAudio) {
        ttsKeepAliveAudio.pause();
        ttsKeepAliveAudio.src = '';
        ttsKeepAliveAudio = null;
        console.log('TTS keepalive audio stopped');
    }
}

function initTtsVoices() {
    const loadVoices = () => {
        const voices = synth.getVoices();
        const sel = document.getElementById('ttsVoice');
        if (!sel || voices.length === 0) return;

        // Vietnamese voices first
        const viVoices = voices.filter(v => v.lang.toLowerCase().includes('vi'));
        const otherVoices = voices.filter(v => !v.lang.toLowerCase().includes('vi'));

        let html = '';

        html += '<optgroup label="🌐 Gi\u1ECDng \u0110ám Mây (Chrome iOS / N\u1EC1n T\u1EA3ng ph\u1EE5) - H\u1ED7 tr\u1EE3 \u0111\u1ECDc khi t\u1EAFt m\u00E0n h\u00ECnh!">';
        html += '<option value="google_online">\u2601\uFE0F Google Ti\u1EBFng Vi\u1EC7t (C\u1EA7n Internet)</option>';
        html += '</optgroup>';

        if (viVoices.length > 0) {
            html += '<optgroup label="\uD83C\uDDFB\uD83C\uDDF3 Ti\u1EBFng Vi\u1EC7t C\u1EE7a M\u00E1y (N\u1EBFu d\u00F9ng Edge n\u00EAn ch\u1ECDn Ho\u00E0i My)">';
            
            // Tự động xếp Hoài My và Google lên hàng đầu
            viVoices.sort((a, b) => {
                const nameA = a.name.toLowerCase();
                const nameB = b.name.toLowerCase();
                const getScore = (name) => {
                    if (name.includes('hoài my') || name.includes('hoai my')) return 3;
                    if (name.includes('nam minh')) return 2;
                    if (name.includes('google')) return 1;
                    return 0;
                };
                return getScore(nameB) - getScore(nameA);
            });

            viVoices.forEach((v, i) => {
                html += `<option value="${v.voiceURI}" ${i === 0 ? 'selected' : ''}>${v.name}</option>`;
            });
            html += '</optgroup>';
        }

        if (otherVoices.length > 0) {
            html += '<optgroup label="🌍 Khác">';
            otherVoices.slice(0, 15).forEach(v => {
                html += `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`;
            });
            html += '</optgroup>';
        }

        html += '<option value="">Mặc định hệ thống</option>';
        sel.innerHTML = html;
    };

    loadVoices();
    synth.onvoiceschanged = loadVoices;

    // Rate slider
    const rateSlider = document.getElementById('ttsRate');
    if (rateSlider) {
        rateSlider.addEventListener('input', () => {
            document.getElementById('ttsRateLabel').textContent = parseFloat(rateSlider.value).toFixed(1) + 'x';
        });
    }
}

function ttsTogglePlay() {
    if (ttsPlaying) {
        ttsStop();
    } else {
        ttsPlay();
    }
}

function ttsPlay() {
    const paras = document.querySelectorAll('#readerContent p[data-para]');
    if (paras.length === 0) return;

    ttsPlaying = true;
    document.getElementById('ttsPlayBtn').textContent = '⏸️ Dừng';
    document.getElementById('ttsPlayBtn').classList.add('playing');

    // Start silent audio to keep browser alive when screen off
    ttsStartKeepAlive();

    ttsPlayPara(ttsCurrentPara);
}

function ttsStop() {
    ttsPlaying = false;
    synth.cancel();
    if(googleAudioInstance) {
        googleAudioInstance.pause();
        googleAudioInstance.removeAttribute('src');
    }
    document.getElementById('ttsPlayBtn').textContent = '▶️ Đọc';
    document.getElementById('ttsPlayBtn').classList.remove('playing');

    // Stop keepalive audio
    ttsStopKeepAlive();

    // Remove highlight
    document.querySelectorAll('#readerContent p.tts-highlight').forEach(p => p.classList.remove('tts-highlight'));
    document.getElementById('ttsStatus').textContent = 'Đã dừng';
}

function ttsPlayPara(index) {
    const paras = document.querySelectorAll('#readerContent p[data-para]');
    if (index >= paras.length) {
        // End of chapter
        ttsStop();
        ttsCurrentPara = 0;

        // Auto next chapter?
        if (document.getElementById('ttsAutoNext').checked) {
            document.getElementById('ttsStatus').textContent = '⏳ Chuyển chương sau...';
            setTimeout(() => {
                if (readerCurrentIndex + 1 < readerChapters.length) {
                    loadReaderChapter(readerCurrentIndex + 1).then(() => {
                        ttsCurrentPara = 0;
                        ttsPlay();
                    });
                } else {
                    document.getElementById('ttsStatus').textContent = '🎉 Hết truyện!';
                }
            }, 1500);
        }
        return;
    }

    if (!ttsPlaying) return;

    ttsCurrentPara = index;
    const para = paras[index];
    const text = para.textContent;

    // Highlight
    document.querySelectorAll('#readerContent p.tts-highlight').forEach(p => p.classList.remove('tts-highlight'));
    para.classList.add('tts-highlight');
    para.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Status
    document.getElementById('ttsStatus').textContent = `\u0110oạn ${index + 1}/${paras.length}`;

    // Speak
    const rate = parseFloat(document.getElementById('ttsRate').value) || 1.0;
    const voiceURI = document.getElementById('ttsVoice').value;

    if (voiceURI === 'google_online') {
        playGoogleTts(text, rate, () => {
            if (ttsPlaying) ttsPlayPara(index + 1);
        });
        return;
    }

    ttsUtterance = new SpeechSynthesisUtterance(text);
    ttsUtterance.lang = 'vi-VN';
    ttsUtterance.rate = rate;

    if (voiceURI) {
        const voice = synth.getVoices().find(v => v.voiceURI === voiceURI);
        if (voice) ttsUtterance.voice = voice;
    }

    ttsUtterance.onend = () => {
        if (ttsPlaying) {
            ttsPlayPara(index + 1);
        }
    };

    ttsUtterance.onerror = (e) => {
        console.error('TTS error:', e);
        if (ttsPlaying) {
            // Skip on error
            setTimeout(() => ttsPlayPara(index + 1), 500);
        }
    };

    // iOS fix: speechSynthesis sometimes pauses
    const resumeCheck = setInterval(() => {
        if (synth.paused && ttsPlaying) {
            synth.resume();
        }
        if (!ttsPlaying || !synth.speaking) {
            clearInterval(resumeCheck);
        }
    }, 1000);

    synth.speak(ttsUtterance);

    // Media Session for lock screen
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: readerChapters[readerCurrentIndex]?.name || `Chương ${readerCurrentIndex + 1}`,
            artist: readerStoryName,
            album: `Đoạn ${index + 1}/${paras.length}`
        });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('play', () => ttsTogglePlay());
        navigator.mediaSession.setActionHandler('pause', () => ttsTogglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => ttsPrevPara());
        navigator.mediaSession.setActionHandler('nexttrack', () => ttsNextPara());
    }
}

function ttsNextPara() {
    if (synth.speaking) synth.cancel();
    if (googleAudioInstance) { googleAudioInstance.pause(); googleAudioInstance.removeAttribute('src'); }
    ttsPlayPara(ttsCurrentPara + 1);
}

function ttsPrevPara() {
    if (synth.speaking) synth.cancel();
    if (googleAudioInstance) { googleAudioInstance.pause(); googleAudioInstance.removeAttribute('src'); }
    ttsPlayPara(Math.max(0, ttsCurrentPara - 1));
}

// === GOOGLE ONLINE TTS ENGINE ===
let googleAudioInstance = null;
let googleChunks = [];
let googleChunkIndex = 0;
let googleOnEnd = null;

function playGoogleTts(text, rate, onend) {
    if (!googleAudioInstance) {
        googleAudioInstance = new Audio();
        googleAudioInstance.setAttribute('playsinline', '');
        googleAudioInstance.onended = () => playNextGoogleChunk();
        googleAudioInstance.onerror = () => {
            console.warn("Google TTS Error, skipping chunk");
            // Retry next chunk
            setTimeout(playNextGoogleChunk, 500);
        };
    }
    
    googleAudioInstance.playbackRate = rate;
    googleOnEnd = onend;
    
    // Chunk array by words strictly max 180 chars to avoid Google HTTP 400 
    googleChunks = [];
    const words = text.split(/\s+/);
    let temp = "";
    for(let i=0; i<words.length; i++) {
        if((temp + " " + words[i]).length > 180) {
            if(temp.trim().length > 0) googleChunks.push(temp.trim());
            temp = words[i];
        } else {
            temp += (temp ? " " : "") + words[i];
        }
    }
    if(temp.trim().length > 0) googleChunks.push(temp.trim());
    
    googleChunkIndex = 0;
    
    if (googleChunks.length === 0) {
        if(onend) onend();
        return;
    }
    
    playNextGoogleChunk();
}

function playNextGoogleChunk() {
    if (!ttsPlaying) {
        if(googleAudioInstance) googleAudioInstance.pause();
        return;
    }
    
    if (googleChunkIndex >= googleChunks.length) {
        if (googleOnEnd) googleOnEnd();
        return;
    }
    
    const chunk = googleChunks[googleChunkIndex++];
    // Prevent empty chunks totally 
    if(!chunk) {
        playNextGoogleChunk();
        return;
    }

    const url = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=vi&q=${encodeURIComponent(chunk)}`;
    
    googleAudioInstance.src = url;
    googleAudioInstance.playbackRate = parseFloat(document.getElementById('ttsRate').value) || 1.0;
    googleAudioInstance.load(); // Force iOS to load the new src
    
    const playPromise = googleAudioInstance.play();
    if (playPromise !== undefined) {
        playPromise.catch(e => {
            console.error("Audio block play failed on iOS:", e);
            // Ignore error and try next chapter if iOS blocked it entirely, but if we're in background, we shouldn't stop!
            setTimeout(playNextGoogleChunk, 500);
        });
    }
}

function toggleTtsMenu() {
    const panel = document.getElementById('ttsPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}
