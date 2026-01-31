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

    // Initialize Google API
    gapi.load('client', initializeGapiClient);
};

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

        // Check if already signed in
        const savedToken = localStorage.getItem('drive_access_token');
        if (savedToken) {
            accessToken = savedToken;
            gapi.client.setToken({ access_token: savedToken });
            showMainApp();
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
    // Remove old indicator if exists
    const old = document.getElementById('publicModeBar');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'publicModeBar';
    bar.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white; padding: 8px 20px;
        display: flex; justify-content: space-between; align-items: center;
        font-size: 13px;
    `;
    bar.innerHTML = `
        <span>🌐 Chế độ công khai - Không cần đăng nhập</span>
        <button onclick="handleSignOut()" style="
            background: rgba(255,255,255,0.2); color: white; border: none;
            padding: 6px 12px; border-radius: 6px; cursor: pointer;
        ">Đổi chế độ</button>
    `;
    document.body.prepend(bar);
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

    // Load saved user
    const savedUser = localStorage.getItem('drive_user');
    if (savedUser) {
        const user = JSON.parse(savedUser);
        document.getElementById('userAvatar').src = user.picture;
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userInfo').classList.remove('hidden');
    } else {
        fetchUserInfo();
    }

    // Thử khôi phục tiến trình đã lưu
    const hasSavedState = localStorage.getItem('drive_player_state');
    if (hasSavedState) {
        await restorePlaybackState();
    } else {
        // Nếu không có, tìm folder gốc
        await findRootFolder();
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

    let html = '';

    // Render folders first
    folders.forEach(folder => {
        html += `
            <div class="folder-item" onclick="openFolder('${folder.id}', '${escapeHtml(folder.name)}')">
                <span class="folder-icon">📁</span>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <span class="folder-meta">→</span>
            </div>
        `;
    });

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
