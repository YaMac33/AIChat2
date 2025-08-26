// グローバル変数
let eventSource = null; // EventSourceオブジェクトを管理
window.currentRoom = null; // 現在選択中のルームIDを管理
let contextMenuTarget = null; // コンテキストメニューの対象要素

// ===== DOM要素の取得 =====
const newChatBtn = document.getElementById('new-chat-btn');
const roomsList = document.getElementById('rooms');
const chatWindow = document.getElementById('chat');
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send-btn');
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

// ===== イベントリスナーの設定 =====
// ページの読み込み完了時にルーム一覧を読み込む
window.addEventListener('load', loadRooms);

// 各ボタンや入力欄にイベントを設定
newChatBtn.addEventListener('click', createNewRoom);
sendButton.addEventListener('click', sendMessage);
toggleSidebarBtn.addEventListener('click', toggleSidebar);
showSidebarBtn.addEventListener('click', showSidebar);
exportHtmlBtn.addEventListener('click', exportAsHtml);
exportManualBtn.addEventListener('click', exportAsManual);

promptInput.addEventListener('keydown', (event) => {
    // Enterキーでも送信できるようにする
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // デフォルトの改行動作をキャンセル
        sendMessage();
    }
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

// ===== 関数定義 =====

/**
 * サイドバーの表示/非表示を切り替える
 */
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

/**
 * サイドバーを表示する
 */
function showSidebar() {
    sidebar.classList.remove('hidden');
    sidebarToggleHidden.classList.remove('show');
    mainChat.classList.remove('expanded');
}

/**
 * 新しいチャットルームを作成する
 */
async function createNewRoom() {
    const title = prompt("新しいチャットのタイトルを入力してください", "新規チャット");
    if (!title) return; // キャンセルされたら何もしない

    // サーバーに新しいルームの作成をリクエスト
    await fetch("/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    });
    // ルーム一覧を再読み込みして更新
    await loadRooms();

    // 作成した最新のルームを自動で選択
    const firstRoomLink = document.querySelector("#rooms li a");
    if (firstRoomLink) {
        firstRoomLink.click();
    }
}

/**
 * サーバーからルーム一覧を取得して表示する
 */
async function loadRooms() {
    const res = await fetch("/rooms");
    const rooms = await res.json();
    roomsList.innerHTML = ""; // 一覧をクリア
    // 新しいものが上に来るように逆順で表示
    rooms.reverse().forEach(r => {
        const li = document.createElement("li");
        li.setAttribute('data-room-id', r.id);
        
        const a = document.createElement("a");
        a.href = "#";
        a.innerText = r.title;
        // 各リンクがクリックされたらselectRoom関数を呼び出す
        a.onclick = (event) => {
            event.preventDefault();
            selectRoom(r.id);
        };
        
        // 右クリックでコンテキストメニューを表示
        a.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showContextMenu(event, r.id);
        });
        
        li.appendChild(a);
        roomsList.appendChild(li);
    });
}

/**
 * 指定されたIDのルームを選択し、メッセージ履歴を表示する
 * @param {string} id - 選択するルームのID
 */
async function selectRoom(id) {
    if (eventSource) {
        eventSource.close(); // 別のルームに移動したらストリームを停止
    }
    
    // アクティブなルームのスタイルを更新
    document.querySelectorAll('#rooms li').forEach(li => li.classList.remove('active'));
    const selectedLi = document.querySelector(`#rooms li[data-room-id="${id}"]`);
    if (selectedLi) {
        selectedLi.classList.add('active');
    }
    
    window.currentRoom = id;
    const res = await fetch(`/rooms/${id}/messages`);
    const msgs = await res.json();
    chatWindow.innerHTML = ""; // チャット欄をクリア
    msgs.forEach(m => {
        appendMessage(m.role, m.content_ja, m.created_at);
    });
    chatWindow.scrollTop = chatWindow.scrollHeight; // 自動で一番下までスクロール
    
    // エクスポートボタンを有効化
    exportHtmlBtn.disabled = false;
    exportManualBtn.disabled = false;
}

/**
 * メッセージを送信する
 */
async function sendMessage() {
    const prompt = promptInput.value.trim();
    // プロンプトが空、ルーム未選択、送信処理中なら何もしない
    if (!prompt || !window.currentRoom || sendButton.disabled) return;

    // 連続送信を防ぐためにボタンを無効化
    sendButton.disabled = true;
    promptInput.value = "";

    // 1. ユーザーのメッセージを画面に即時反映
    appendMessage('user', prompt);

    // 2. ユーザーのメッセージをサーバーに保存
    await fetch(`/rooms/${window.currentRoom}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });

    // 3. AIの回答表示用の空の要素を作成
    const assistantMessageDiv = appendMessage('assistant', '');

    // 4. EventSourceを使ってストリーミングAPIに接続
    eventSource = new EventSource(`/rooms/${window.currentRoom}/messages-stream`);

    // 5. サーバーからデータが送られてくるたびに実行される処理
    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.error) {
            assistantMessageDiv.querySelector('.message').innerText = data.error; // エラーメッセージを表示
            eventSource.close();
            sendButton.disabled = false; // ボタンを有効に戻す
        } else {
            const messageEl = assistantMessageDiv.querySelector('.message');
            messageEl.innerHTML = formatMessageContent(messageEl.innerText + data.text);
            chatWindow.scrollTop = chatWindow.scrollHeight; // 自動スクロール
        }
    };

    // 6. ストリームがエラーまたは終了した時の処理
    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        const messageEl = assistantMessageDiv.querySelector('.message');
        if(messageEl.innerText === '') {
            messageEl.innerText = "ストリーム接続に失敗しました。";
        }
        eventSource.close();
        sendButton.disabled = false; // ボタンを有効に戻す
    };
}

/**
 * メッセージ内容をフォーマットしてコードブロックを適用
 * @param {string} text - フォーマットするテキスト
 * @returns {string} - フォーマットされたHTML
 */
function formatMessageContent(text) {
    // コードブロック（```で囲まれた部分）を<pre>タグに変換
    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    
    // インラインコード（`で囲まれた部分）を<code>タグに変換
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    
    // 改行を<br>に変換（preタグ内は除く）
    text = text.replace(/\n/g, '<br>');
    
    return text;
}

/**
 * チャットウィンドウにメッセージ要素を追加する
 * @param {string} role - 'user' または 'assistant'
 * @param {string} text - 表示するメッセージテキスト
 * @param {string} timestamp - メッセージのタイムスタンプ（オプション）
 * @returns {HTMLElement} - 作成されたメッセージのコンテナ要素
 */
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
    
    if (timestamp) {
        // サーバーから受け取ったタイムスタンプをフォーマット
        const date = new Date(timestamp);
        timestampDiv.innerText = formatTimestamp(date);
    } else {
        // 現在時刻を使用
        timestampDiv.innerText = formatTimestamp(new Date());
    }
    
    container.appendChild(messageDiv);
    container.appendChild(timestampDiv);
    chatWindow.appendChild(container);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    return container;
}

/**
 * タイムスタンプを「HH:MM」形式でフォーマット
 * @param {Date} date - フォーマットする日付オブジェクト
 * @returns {string} - フォーマットされたタイムスタンプ
 */
function formatTimestamp(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * コンテキストメニューを表示
 * @param {MouseEvent} event - マウスイベント
 * @param {string} roomId - ルームID
 */
function showContextMenu(event, roomId) {
    contextMenuTarget = roomId;
    contextMenu.style.display = 'block';
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
}

/**
 * コンテキストメニューを非表示
 */
function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextMenuTarget = null;
}

/**
 * 名称変更モーダルを表示
 */
function showRenameModal() {
    hideContextMenu();
    if (!contextMenuTarget) return;
    
    const roomLi = document.querySelector(`#rooms li[data-room-id="${contextMenuTarget}"]`);
    const currentName = roomLi ? roomLi.querySelector('a').innerText : '';
    document.getElementById('rename-input').value = currentName;
    renameModal.classList.add('show');
    document.getElementById('rename-input').focus();
}

/**
 * 名称変更モーダルを非表示
 */
function hideRenameModal() {
    renameModal.classList.remove('show');
    document.getElementById('rename-input').value = '';
}

/**
 * 名称変更を確定
 */
async function confirmRename() {
    if (!contextMenuTarget) return;
    
    const newName = document.getElementById('rename-input').value.trim();
    if (!newName) return;
    
    try {
        const response = await fetch(`/rooms/${contextMenuTarget}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newName })
        });
        
        if (response.ok) {
            await loadRooms();
            if (window.currentRoom === contextMenuTarget) {
                // 現在選択中のルームの場合、再選択してアクティブ状態を維持
                const selectedLi = document.querySelector(`#rooms li[data-room-id="${contextMenuTarget}"]`);
                if (selectedLi) {
                    selectedLi.classList.add('active');
                }
            }
        }
    } catch (error) {
        console.error('名称変更に失敗しました:', error);
