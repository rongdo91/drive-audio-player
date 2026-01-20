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

    // Get user info
    fetchUserInfo();
    showMainApp();
}

function handleSignOut() {
    google.accounts.oauth2.revoke(accessToken, () => {
        accessToken = null;
        localStorage.removeItem('drive_access_token');
        localStorage.removeItem('drive_user');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('userInfo').classList.add('hidden');
    });
}

async function fetchUserInfo() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
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

    // Find root folder
    await findRootFolder();
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
            const response = await gapi.client.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'nextPageToken, files(id, name, mimeType, size)',
                pageSize: 1000,
                pageToken: pageToken
            });

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
        const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;

        audio.src = url;
        audio.playbackRate = currentSpeed;

        // Set auth header via fetch and blob
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!response.ok) throw new Error('Failed to fetch audio');

        const blob = await response.blob();
        audio.src = URL.createObjectURL(blob);
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
        audioFileIds: audioFiles.map(f => f.id)
    };
    localStorage.setItem('drive_player_state', JSON.stringify(state));
}

function loadSavedState() {
    const savedSpeed = localStorage.getItem('drive_speed');
    if (savedSpeed) {
        currentSpeed = parseFloat(savedSpeed);
    }
}
