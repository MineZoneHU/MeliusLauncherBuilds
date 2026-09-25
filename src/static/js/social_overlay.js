const ipcRenderer = window.ipcRenderer;

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let friends = [];
let activeFriend = null;
let chatClosedByUser = false;
let currentTab = 'all';
let myCurrentUsername = '';

const friendsListEl = document.getElementById('friends-list');
const messagesContainerEl = document.getElementById('messages-container');
const emptyPlaceholderEl = document.getElementById('empty-chat-placeholder');
const chatInputEl = document.getElementById('chat-input');
const searchInputEl = document.getElementById('friend-search-input');
const btnAddFriendEl = document.getElementById('btn-add-friend');
const btnSendMessageEl = document.getElementById('btn-send-message');
const btnCloseOverlayEl = document.getElementById('btn-close-overlay');
const currentUsernameEl = document.getElementById('current-username');

const activeFriendNameEl = document.getElementById('active-friend-name');
const activeFriendStatusEl = document.getElementById('active-friend-status');
const activeFriendStatusDotEl = document.getElementById('active-friend-status-dot');

const badgeAllEl = document.getElementById('badge-all');
const badgeIngameEl = document.getElementById('badge-ingame');
const badgeReqsEl = document.getElementById('badge-reqs');

// ─── FontAwesome 6 icon map ───────────────────────────────────────────────
const RANK_ICON_MAP = {
    'crown':               'fa-crown',
    'shield-halved':       'fa-shield-halved',
    'code':                'fa-code',
    'hammer':              'fa-hammer',
    'gem':                 'fa-gem',
    'star':                'fa-star',
    'fire':                'fa-fire',
    'wand-magic-sparkles': 'fa-wand-magic-sparkles',
    'video':               'fa-video',
    'flask':               'fa-flask',
    'user':                'fa-user'
};

function getRankIconHtml(rankIcon, rankColor, rankName, size = 12) {
    const faClass = RANK_ICON_MAP[rankIcon] || 'fa-user';
    const color = (rankColor && /^#[0-9A-Fa-f]{3,8}$/.test(rankColor)) ? rankColor : '#94A3B8';
    return `<i class="fa-solid ${faClass}" title="${escapeHtml(rankName || '')}" style="color:${color};font-size:${size}px;margin-right:4px;vertical-align:middle;flex-shrink:0;"></i>`;
}

function getRankBadgeHtml(rankIcon, rankColor, rankName) {
    const iconHtml = getRankIconHtml(rankIcon, rankColor, rankName, 10);
    const displayName = escapeHtml(rankName || 'Játékos');
    const color = (rankColor && /^#[0-9A-Fa-f]{3,8}$/.test(rankColor)) ? rankColor : '#94A3B8';
    return `<span class="rank-tag friend-rank-tag" style="color:${color}; border-color:${color}; background:${color}1A; font-size:10px; padding:1px 6px; border-radius:4px; margin-left:6px; border:1px solid; display:inline-flex; align-items:center; gap:3px; vertical-align:middle; text-transform:none; letter-spacing:0.3px; font-weight:700; line-height:14px;">${iconHtml}<span>${displayName}</span></span>`;
}

// ─── Own Rank & Presence Updater ──────────────────────────────────────────
function updateOwnRank(meta) {
    const ownRankEl = document.getElementById('own-rank-tag') || document.querySelector('.user-card .rank-tag');
    if (!ownRankEl || !meta) return;

    const iconHtml = getRankIconHtml(meta.rankIcon, meta.rankColor, meta.rankName, 12);
    const displayName = escapeHtml(meta.rankName || meta.rank || 'Játékos');
    const color = (meta.rankColor && /^#[0-9A-Fa-f]{3,8}$/.test(meta.rankColor)) ? meta.rankColor : '#94A3B8';

    ownRankEl.innerHTML = `${iconHtml}<span>${displayName}</span>`;
    ownRankEl.style.color = color;
    ownRankEl.style.borderColor = color;
    ownRankEl.style.background = `${color}1A`;
}

function fetchOwnStatus(username) {
    const userToFetch = username || myCurrentUsername || (currentUsernameEl ? currentUsernameEl.textContent.trim() : '');
    if (!userToFetch || userToFetch === 'TheLeventhe') return;

    fetch(`https://zoneapi.minezone.hu/api/social/status?username=${encodeURIComponent(userToFetch)}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.success) {
                updateOwnRank(data);
                const userActivityEl = document.getElementById('user-activity');
                if (userActivityEl && data.presence) {
                    userActivityEl.textContent = data.presence;
                }
            }
        })
        .catch(() => {});
}

// Poll own status every 4 seconds
setInterval(() => {
    fetchOwnStatus();
}, 4000);

// ─── Close Overlay Handlers ───────────────────────────────────────────────
function closeOverlay() {
    ipcRenderer.send('social-overlay-hide');
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlay();
});

if (btnCloseOverlayEl) btnCloseOverlayEl.addEventListener('click', closeOverlay);

// ─── Tabs Filtering ───────────────────────────────────────────────────────
document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.getAttribute('data-tab');
        renderFriendsList();
    });
});

// ─── Render Friends List ──────────────────────────────────────────────────
function renderFriendsList() {
    friendsListEl.innerHTML = '';
    
    let filtered = friends.filter(f => {
        const matchesSearch = searchInputEl.value.trim() === '' || f.name.toLowerCase().includes(searchInputEl.value.toLowerCase());
        if (!matchesSearch) return false;
        if (currentTab === 'ingame') return f.online;
        return true;
    });

    const onlineCount = friends.filter(f => f.online).length;
    badgeAllEl.textContent = friends.length;
    badgeIngameEl.textContent = onlineCount;

    if (filtered.length === 0) {
        friendsListEl.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 24px 8px; font-size: 13px;">
                Nincs megjeleníthető barát.
            </div>
        `;
        return;
    }

    const onlines = filtered.filter(f => f.online);
    const offlines = filtered.filter(f => !f.online);

    if (onlines.length > 0) {
        const cat = document.createElement('div');
        cat.className = 'category-header';
        cat.textContent = `Online \u2022 MineZone (${onlines.length})`;
        friendsListEl.appendChild(cat);
        onlines.forEach(f => friendsListEl.appendChild(createFriendItem(f)));
    }

    if (offlines.length > 0) {
        const cat = document.createElement('div');
        cat.className = 'category-header';
        cat.textContent = `Offline (${offlines.length})`;
        friendsListEl.appendChild(cat);
        offlines.forEach(f => friendsListEl.appendChild(createFriendItem(f)));
    }
}

function getStatusText(f) {
    if (!f.online) return 'Offline';
    if (f.customStatus) return f.customStatus;
    if (f.presence && f.presence !== 'Offline') return f.presence;
    if (f.server && f.server !== 'Offline') {
        if (f.server === 'Elérhető') return 'MineZone • Elérhető';
        return `MineZone \u2022 ${f.server}`;
    }
    return 'MineZone • Elérhető';
}

function createFriendItem(f) {
    const item = document.createElement('div');
    item.className = 'friend-item' + (activeFriend && activeFriend.name.toLowerCase() === f.name.toLowerCase() ? ' active' : '');
    
    const statusText = getStatusText(f);
    const rankBadgeHtml = getRankBadgeHtml(f.rankIcon, f.rankColor, f.rankName);
    const bestFriendStar = f.bestFriend ? '<span style="color:#FACC15;font-size:11px;margin-left:3px;" title="Legjobb bar\u00e1t">\u2605</span>' : '';

    item.innerHTML = `
        <div class="avatar-wrapper mini">
            <img src="https://cdn.minezone.hu/skins/default.png" class="avatar-img" onerror="this.src='img/launcher/steve.png'">
            <span class="status-indicator ${f.online ? 'online' : ''}"></span>
        </div>
        <div class="friend-details">
            <div class="name-row">
                <span class="friend-name">${escapeHtml(f.name)}</span>${bestFriendStar}${rankBadgeHtml}
            </div>
            <span class="friend-subtext ${f.online ? 'online' : ''}">${escapeHtml(statusText)}</span>
        </div>
    `;

    item.addEventListener('click', () => selectFriend(f));
    return item;
}

function selectFriend(f) {
    chatClosedByUser = false;
    activeFriend = f;
    activeFriendNameEl.textContent = f.name;
    activeFriendStatusEl.textContent = getStatusText(f);
    activeFriendStatusDotEl.className = 'status-indicator' + (f.online ? ' online' : '');
    
    const rankTagEl = document.getElementById('active-friend-rank');
    if (rankTagEl && f.rankName) {
        const iconHtml = getRankIconHtml(f.rankIcon, f.rankColor, f.rankName, 12);
        rankTagEl.innerHTML = `${iconHtml}<span>${escapeHtml(f.rankName)}</span>`;
        const color = (f.rankColor && /^#[0-9A-Fa-f]{3,8}$/.test(f.rankColor)) ? f.rankColor : '#94A3B8';
        rankTagEl.style.color = color;
        rankTagEl.style.borderColor = color;
        rankTagEl.style.background = `${color}1A`;
    }

    chatInputEl.placeholder = `\u00dczen\u00e9t ${f.name} r\u00e9sz\u00e9re...`;
    renderFriendsList();

    ipcRenderer.send('social-overlay-fetch-chat', { friendName: f.name });
}

// ─── Close Chat [✕] ───────────────────────────────────────────────────────
const btnClearChatEl = document.getElementById('btn-clear-chat');
if (btnClearChatEl) {
    btnClearChatEl.addEventListener('click', () => {
        activeFriend = null;
        chatClosedByUser = true;
        renderFriendsList();
        activeFriendNameEl.textContent = 'V\u00e1lassz bar\u00e1tot...';
        activeFriendStatusEl.textContent = 'Offline';
        activeFriendStatusDotEl.className = 'status-indicator';
        chatInputEl.placeholder = '\u00cdrj \u00fczenetet...';
        const rankTagEl = document.getElementById('active-friend-rank');
        if (rankTagEl) { rankTagEl.innerHTML = ''; rankTagEl.style.color = ''; rankTagEl.style.borderColor = ''; }
        messagesContainerEl.innerHTML = `
            <div class="empty-chat-placeholder" id="empty-chat-placeholder">
                <div class="empty-icon">\ud83d\udcac</div>
                <h3>Kezdj el besz\u00e9lgetni!</h3>
                <p>V\u00e1lassz ki egy bar\u00e1tot a bal oldali list\u00e1b\u00f3l, \u00e9s \u00edrj neki \u00fczenetet.</p>
            </div>
        `;
    });
}

// ─── Send Message ─────────────────────────────────────────────────────────
function sendMessage() {
    if (!activeFriend) return;
    const text = chatInputEl.value.trim();
    if (!text) return;

    appendMessage('You', text, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), true);
    ipcRenderer.send('social-overlay-send-msg', { recipient: activeFriend.name, content: text });

    chatInputEl.value = '';
    chatInputEl.focus();
}

if (btnSendMessageEl) btnSendMessageEl.addEventListener('click', sendMessage);
if (chatInputEl) {
    chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

// ─── Add Friend ───────────────────────────────────────────────────────────
function addFriend() {
    const name = searchInputEl.value.trim();
    if (!name) return;

    ipcRenderer.send('social-overlay-add-friend', { friendName: name });
    searchInputEl.value = '';
}

if (btnAddFriendEl) btnAddFriendEl.addEventListener('click', addFriend);
if (searchInputEl) searchInputEl.addEventListener('input', renderFriendsList);

// ─── Append Message to Viewport ──────────────────────────────────────────
function appendMessage(sender, text, time, isSelf) {
    if (emptyPlaceholderEl) emptyPlaceholderEl.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'chat-row ' + (isSelf ? 'self' : 'friend');

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = time;

    row.appendChild(bubble);
    row.appendChild(timeSpan);

    messagesContainerEl.appendChild(row);
    messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

// ─── IPC Listeners from Launcher ─────────────────────────────────────────
ipcRenderer.on('set-user-info', (event, data) => {
    if (data.username) {
        myCurrentUsername = data.username;
        if (currentUsernameEl) currentUsernameEl.textContent = data.username;
        fetchOwnStatus(data.username);
    }
    if (data.activity || data.presence || data.server) {
        const userActivityEl = document.getElementById('user-activity');
        if (userActivityEl) {
            userActivityEl.textContent = data.activity || data.presence || `MineZone \u2022 ${data.server}`;
        }
    }
    if (data.rankName || data.rankColor || data.rankIcon) {
        updateOwnRank(data);
    }
});

ipcRenderer.on('update-presence', (event, presence) => {
    const userActivityEl = document.getElementById('user-activity');
    if (userActivityEl && presence) {
        userActivityEl.textContent = presence;
    }
});

ipcRenderer.on('update-friends', (event, list) => {
    friends = list || [];
    renderFriendsList();
    if (!chatClosedByUser && !activeFriend && friends.length > 0) {
        selectFriend(friends[0]);
    } else if (activeFriend) {
        const updated = friends.find(f => f.name.toLowerCase() === activeFriend.name.toLowerCase());
        if (updated) {
            activeFriend = updated;
            activeFriendStatusEl.textContent = getStatusText(updated);
            activeFriendStatusDotEl.className = 'status-indicator' + (updated.online ? ' online' : '');
        }
    }
});

ipcRenderer.on('sync-chat', (event, { friend, messages }) => {
    if (activeFriend && activeFriend.name.toLowerCase() === friend.toLowerCase()) {
        messagesContainerEl.innerHTML = '';
        if (!messages || messages.length === 0) {
            messagesContainerEl.innerHTML = `
                <div class="empty-chat-placeholder">
                    <div class="empty-icon">\ud83d\udcac</div>
                    <h3>Kezdj el besz\u00e9lgetni!</h3>
                    <p>Nincs m\u00e9g kor\u00e1bbi \u00fczenet ${escapeHtml(friend)} j\u00e1t\u00e9kossal.</p>
                </div>
            `;
        } else {
            messages.forEach(m => {
                appendMessage(m.sender, m.text, m.time, m.isSelf);
            });
        }
    }
});

// Initial boot check
if (currentUsernameEl && currentUsernameEl.textContent.trim() !== 'TheLeventhe') {
    fetchOwnStatus(currentUsernameEl.textContent.trim());
}
