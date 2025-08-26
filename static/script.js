// =============================
// 名前空間オブジェクトに集約
// =============================
const ChatApp = {
    eventSource: null,
    currentRoom: null,
    contextMenuTarget: null,
};

// ===== DOM要素取得 =====
const newChatBtn = document.getElementById('new-chat-btn');
const roomsList = document.getElementById('rooms');
const chatWindow = document.getElementById('chat');
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');
const sidebar = document.getElementById('sidebar');
const mainChat = document.getElementById('main-chat');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const showSidebarBtn = document.getElementById('show-sidebar-btn');
const sidebarToggleHidden = document.getElementById('sidebar-toggle-hidden');
const contextMenu = document.getElementById('context-menu');
const renameModal = document.getElementById('rename-modal');
const deleteModal = document.getElementById('delete-modal');
const exportHtmlBtn = document.getElementById('export-html-btn');
const exportManualBtn = document.getElementById('export-manual-btn');

// ===== イベント設定 =====
window.addEventListener('load', loadRooms);
newChatBtn.addEventListener('click', createNewRoom);
toggleSidebarBtn.addEventListener('click', toggleSidebar);
showSidebarBtn.addEventListener('click', showSidebar);
exportHtmlBtn.addEventListener('click', exportAsHtml);
exportManualBtn.addEventListener('click', exportAsManual);
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
});

// コンテキストメニューのイベント
document.addEventListener('click', hideContextMenu);
document.getElementById('rename-room').addEventListener('click', showRenameModal);
document.getElementById('delete-room').addEventListener('click', showDeleteModal);

// モーダルのイベント
document.getElementById('rename-confirm').addEventListener('click', confirmRename);
document.getElementById('rename-cancel').addEventListener('click', hideRenameModal);
document.getElementById('delete-confirm').addEventListener('click', confirmDelete);
document.getElementById('delete-cancel').addEventListener('click', hideDeleteModal);

// モーダル背景クリックで閉じる
renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) hideRenameModal();
});
deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) hideDeleteModal();
});

// =============================
// 関数定義
// =============================

function toggleSidebar() {
    sidebar.classList.toggle('hidden');
    if (sidebar.classList.contains('hidden')) {
        sidebarToggleHidden.classList.add('show');
        mainChat.classList.add('expanded');
    } else {
        sidebarToggleHidden.classList.remove('show');
        mainChat.classList.remove('expanded');
    }
}

function showSidebar() {
    sidebar.classList.remove('hidden');
    sidebarToggleHidden.classList.remove('show');
    mainChat.classList.remove('expanded');
}

async function createNewRoom() {
    const title = prompt("新しいチャットのタイトルを入力してください", "新規チャット");
    if (!title) return;

    await fetch("/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    });
    await loadRooms();

    const firstRoomLink = document.querySelector("#rooms li a");
    if (firstRoomLink) firstRoomLink.click();
}

async function loadRooms() {
    const res = await fetch("/rooms");
    const rooms = await res.json();
    const frag = document.createDocumentFragment();
    roomsList.innerHTML = "";

    rooms.reverse().forEach(r => {
        const li = document.createElement("li");
        li.setAttribute('data-room-id', r.id);

        const a = document.createElement("a");
        a.href = "#";
        a.innerText = r.title;
        a.onclick = (event) => {
            event.preventDefault();
            selectRoom(r.id);
        };
        a.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showContextMenu(event, r.id);
        });

        li.appendChild(a);
        frag.appendChild(li);
    });

    roomsList.appendChild(frag);
}

async function selectRoom(id) {
    if (ChatApp.eventSource) {
        ChatApp.eventSource.close();
        ChatApp.eventSource = null;
    }

    document.querySelectorAll('#rooms li').forEach(li => li.classList.remove('active'));
    const selectedLi = document.querySelector(`#rooms li[data-room-id="${id}"]`);
    if (selectedLi) selectedLi.classList.add('active');

    ChatApp.currentRoom = id;
    const res = await fetch(`/rooms/${id}/messages`);
    const msgs = await res.json();
    chatWindow.innerHTML = "";

    msgs.forEach(m => appendMessage(m.role, m.content_ja, m.created_at));
    chatWindow.scrollTop = chatWindow.scrollHeight;

    exportHtmlBtn.disabled = false;
    exportManualBtn.disabled = false;
}

async function sendMessage() {
    const prompt = promptInput.value.trim();
    if (!prompt || !ChatApp.currentRoom || sendButton.disabled) return;

    sendButton.disabled = true;
    promptInput.value = "";
    appendMessage('user', prompt);

    await fetch(`/rooms/${ChatApp.currentRoom}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });

    const assistantMessageDiv = appendMessage('assistant', '');
    ChatApp.eventSource = new EventSource(`/rooms/${ChatApp.currentRoom}/messages-stream`);

    ChatApp.eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        const messageEl = assistantMessageDiv.querySelector('.message');
        if (data.error) {
            messageEl.innerText = data.error;
            ChatApp.eventSource.close();
            sendButton.disabled = false;
        } else {
            messageEl.innerHTML = formatMessageContent(messageEl.innerText + data.text);
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    };

    ChatApp.eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        const messageEl = assistantMessageDiv.querySelector('.message');
        if (messageEl.innerText === '') {
            messageEl.innerText = "ストリーム接続に失敗しました。";
        }
        ChatApp.eventSource.close();
        sendButton.disabled = false;
    };
}

function formatMessageContent(text) {
    return text
        .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>'); // preタグ内はHTMLがそのまま維持される
}

function appendMessage(role, text, timestamp = null) {
    const container = document.createElement("div");
    container.classList.add('message-container', role);

    const messageDiv = document.createElement("div");
    messageDiv.classList.add('message');
    if (role === 'user') {
        messageDiv.innerText = text;
    } else {
        messageDiv.innerHTML = formatMessageContent(text);
    }

    const timestampDiv = document.createElement("div");
    timestampDiv.classList.add('timestamp');
    timestampDiv.innerText = formatTimestamp(timestamp ? new Date(timestamp) : new Date());

    container.appendChild(messageDiv);
    container.appendChild(timestampDiv);
    chatWindow.appendChild(container);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return container;
}

function formatTimestamp(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function showContextMenu(event, roomId) {
    ChatApp.contextMenuTarget = roomId;
    contextMenu.style.display = 'block';
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
    ChatApp.contextMenuTarget = null;
}

function showRenameModal() {
    hideContextMenu();
    if (!ChatApp.contextMenuTarget) return;
    const roomLi = document.querySelector(`#rooms li[data-room-id="${ChatApp.contextMenuTarget}"]`);
    const currentName = roomLi ? roomLi.querySelector('a').innerText : '';
    document.getElementById('rename-input').value = currentName;
    renameModal.classList.add('show');
    document.getElementById('rename-input').focus();
}

function hideRenameModal() {
    renameModal.classList.remove('show');
    document.getElementById('rename-input').value = '';
}

async function confirmRename() {
    if (!ChatApp.contextMenuTarget) return;
    const newName = document.getElementById('rename-input').value.trim();
    if (!newName) return;

    try {
        const response = await fetch(`/rooms/${ChatApp.contextMenuTarget}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newName })
        });
        if (response.ok) {
            await loadRooms();
            if (ChatApp.currentRoom === ChatApp.contextMenuTarget) {
                const selectedLi = document.querySelector(`#rooms li[data-room-id="${ChatApp.contextMenuTarget}"]`);
                if (selectedLi) selectedLi.classList.add('active');
            }
        }
    } catch (error) {
        console.error('名称変更に失敗しました:', error);
    }
    hideRenameModal();
}

function showDeleteModal() {
    hideContextMenu();
    if (!ChatApp.contextMenuTarget) return;
    deleteModal.classList.add('show');
}

function hideDeleteModal() {
    deleteModal.classList.remove('show');
}

async function confirmDelete() {
    if (!ChatApp.contextMenuTarget) return;

    try {
        const response = await fetch(`/rooms/${ChatApp.contextMenuTarget}`, { method: 'DELETE' });
        if (response.ok) {
            if (ChatApp.currentRoom === ChatApp.contextMenuTarget) {
                ChatApp.currentRoom = null;
                chatWindow.innerHTML = '';
                exportHtmlBtn.disabled = true;
                exportManualBtn.disabled = true;
                if (ChatApp.eventSource) {
                    ChatApp.eventSource.close();
                    ChatApp.eventSource = null;
                }
            }
            await loadRooms();
        }
    } catch (error) {
        console.error('削除に失敗しました:', error);
    }
    hideDeleteModal();
}

async function exportAsHtml() {
    if (!ChatApp.currentRoom) return;
    try {
        const response = await fetch(`/rooms/${ChatApp.currentRoom}/export/html`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat_${ChatApp.currentRoom}_${Date.now()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('HTML出力に失敗しました:', error);
        alert('HTML出力に失敗しました');
    }
}

async function exportAsManual() {
    if (!ChatApp.currentRoom) return;
    try {
        const response = await fetch(`/rooms/${ChatApp.currentRoom}/export/manual`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `manual_${ChatApp.currentRoom}_${Date.now()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('マニュアル出力に失敗しました:', error);
        alert('マニュアル出力に失敗しました');
    }
}