// グローバル変数
let eventSource = null; // EventSourceオブジェクトを管理
window.currentRoom = null; // 現在選択中のルームIDを管理

// ===== DOM要素の取得 =====
const newChatBtn = document.getElementById('new-chat-btn');
const roomsList = document.getElementById('rooms');
const chatWindow = document.getElementById('chat');
const promptInput = document.getElementById('prompt');
const sendButton = document.getElementById('send-btn');

// ===== イベントリスナーの設定 =====
// ページの読み込み完了時にルーム一覧を読み込む
window.addEventListener('load', loadRooms);
// 各ボタンや入力欄にイベントを設定
newChatBtn.addEventListener('click', createNewRoom);
sendButton.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (event) => {
    // Enterキーでも送信できるようにする
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // デフォルトの改行動作をキャンセル
        sendMessage();
    }
});

// ===== 関数定義 =====

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
        const a = document.createElement("a");
        a.href = "#";
        a.innerText = r.title;
        // 各リンクがクリックされたらselectRoom関数を呼び出す
        a.onclick = (event) => {
            event.preventDefault();
            selectRoom(r.id);
        };
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
    window.currentRoom = id;
    const res = await fetch(`/rooms/${id}/messages`);
    const msgs = await res.json();
    chatWindow.innerHTML = ""; // チャット欄をクリア
    msgs.forEach(m => {
        appendMessage(m.role, m.content_ja);
    });
    chatWindow.scrollTop = chatWindow.scrollHeight; // 自動で一番下までスクロール
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
            assistantMessageDiv.innerText = data.error; // エラーメッセージを表示
            eventSource.close();
            sendButton.disabled = false; // ボタンを有効に戻す
        } else {
            assistantMessageDiv.innerText += data.text; // 受け取った文字を追加
            chatWindow.scrollTop = chatWindow.scrollHeight; // 自動スクロール
        }
    };

    // 6. ストリームがエラーまたは終了した時の処理
    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        if(assistantMessageDiv.innerText === '') {
            assistantMessageDiv.innerText = "ストリーム接続に失敗しました。";
        }
        eventSource.close();
        sendButton.disabled = false; // ボタンを有効に戻す
    };
}

/**
 * チャットウィンドウにメッセージ要素を追加する
 * @param {string} role - 'user' または 'assistant'
 * @param {string} text - 表示するメッセージテキスト
 * @returns {HTMLElement} - 作成されたメッセージのdiv要素
 */
function appendMessage(role, text) {
    const div = document.createElement("div");
    div.classList.add('message', role);
    div.innerText = text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}
