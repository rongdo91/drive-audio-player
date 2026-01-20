// =============================================
// CẤU HÌNH - THAY ĐỔI GIÁ TRỊ NÀY
// =============================================

const CONFIG = {
    // Lấy từ Google Cloud Console -> APIs & Services -> Credentials
    CLIENT_ID: '948185899380-1j76eaurnqml8tgd90irnpfomd2lbgif.apps.googleusercontent.com',

    // API Key (optional, nhưng nên có)
    API_KEY: 'AIzaSyAD7Swkn5PakDA3fKhrCsc2qEZMZkA53lg',

    // Tên folder chứa truyện trên Drive
    ROOT_FOLDER_NAME: 'StoryDownloader',

    // Scopes cần thiết (chỉ đọc)
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly',

    // Discovery docs
    DISCOVERY_DOCS: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
};

// =============================================
// HƯỚNG DẪN LẤY CLIENT_ID VÀ API_KEY:
// =============================================
//
// 1. Vào https://console.cloud.google.com/
// 2. Tạo Project mới hoặc chọn Project có sẵn
// 3. Vào APIs & Services -> Library -> Tìm "Google Drive API" -> Enable
// 4. Vào APIs & Services -> Credentials
//
// TẠO API KEY:
// - Click "Create Credentials" -> "API Key"
// - Copy key và dán vào API_KEY ở trên
// - (Optional) Click "Restrict Key" để giới hạn chỉ dùng cho Drive API
//
// TẠO OAUTH CLIENT ID:
// - Click "Create Credentials" -> "OAuth client ID"
// - Nếu chưa có Consent Screen, làm theo hướng dẫn:
//   - User Type: External
//   - App name: Drive Audio Player
//   - Thêm scope: .../auth/drive.readonly
// - Application type: Web application
// - Authorized JavaScript origins:
//   - https://YOUR-USERNAME.github.io
//   - http://localhost:5500 (để test local)
// - Copy Client ID và dán vào CLIENT_ID ở trên
//
// =============================================
