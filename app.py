from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_cors import CORS
from datetime import datetime
import json
import time
import io
import os  # ← 追加

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)  # ← 必要に応じて有効化

# 起動時に環境変数 PORT を取得（Render対応）
port = int(os.environ.get("PORT", 5000))


# メモリ上にルームとメッセージを保持（本番はDBを推奨）
rooms = []
messages = {}  # room_id -> list of {role, content_ja, created_at}

# ID採番用カウンタ
room_counter = 1

@app.route("/")
def index():
    return render_template("index.html")


# =============================
# ルーム関連API
# =============================
@app.route("/rooms", methods=["GET"])
def get_rooms():
    return jsonify(rooms)


@app.route("/rooms", methods=["POST"])
def create_room():
    global room_counter
    data = request.get_json()
    title = data.get("title", f"新規チャット{room_counter}")
    room_id = str(room_counter)
    room_counter += 1
    new_room = {"id": room_id, "title": title, "created_at": datetime.now().isoformat()}
    rooms.append(new_room)
    messages[room_id] = []
    return jsonify(new_room)


@app.route("/rooms/<room_id>", methods=["PUT"])
def update_room(room_id):
    data = request.get_json()
    title = data.get("title")
    for r in rooms:
        if r["id"] == room_id:
            r["title"] = title
            return jsonify({"status": "ok", "id": room_id, "title": title})
    return jsonify({"error": "not found"}), 404


@app.route("/rooms/<room_id>", methods=["DELETE"])
def delete_room(room_id):
    global rooms, messages
    rooms = [r for r in rooms if r["id"] != room_id]
    if room_id in messages:
        del messages[room_id]
    return jsonify({"status": "deleted"})


# =============================
# メッセージ関連API
# =============================
@app.route("/rooms/<room_id>/messages", methods=["GET"])
def get_messages(room_id):
    return jsonify(messages.get(room_id, []))


@app.route("/rooms/<room_id>/messages", methods=["POST"])
def add_message(room_id):
    data = request.get_json()
    prompt = data.get("prompt", "")
    msg_user = {
        "role": "user",
        "content_ja": prompt,
        "created_at": datetime.now().isoformat()
    }
    messages[room_id].append(msg_user)
    # 仮のAI応答を追加（本番ではストリーム出力に置き換え）
    msg_assistant = {
        "role": "assistant",
        "content_ja": f"これはAIの応答です: {prompt}",
        "created_at": datetime.now().isoformat()
    }
    messages[room_id].append(msg_assistant)
    return jsonify({"status": "ok"})


@app.route("/rooms/<room_id>/messages-stream")
def stream_message(room_id):
    def generate():
        text = "これはストリーミング応答です"
        for c in text:
            time.sleep(0.05)
            yield f"data: {json.dumps({'text': c})}\n\n"
        yield f"data: {json.dumps({'text': '', 'done': True})}\n\n"
    return Response(generate(), mimetype="text/event-stream")


# =============================
# 出力API（HTML / マニュアル）
# =============================
@app.route("/rooms/<room_id>/export/html")
def export_html(room_id):
    # ルーム履歴をHTML化してダウンロード
    html = "<html><body>"
    html += f"<h1>チャットルーム {room_id}</h1>"
    for m in messages.get(room_id, []):
        role = "ユーザー" if m["role"] == "user" else "アシスタント"
        content = m["content_ja"].replace("<", "&lt;").replace(">", "&gt;")
        html += f"<p><b>{role}</b>: {content}</p>"
    html += "</body></html>"

    buf = io.BytesIO(html.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, mimetype="text/html",
                     as_attachment=True,
                     download_name=f"chat_{room_id}.html")


@app.route("/rooms/<room_id>/export/manual")
def export_manual(room_id):
    # 簡易的にテキストマニュアル化
    text = f"### チャットルーム {room_id} の記録\n\n"
    for m in messages.get(room_id, []):
        role = "ユーザー" if m["role"] == "user" else "アシスタント"
        text += f"{role}: {m['content_ja']}\n"
    buf = io.BytesIO(text.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, mimetype="text/plain",
                     as_attachment=True,
                     download_name=f"manual_{room_id}.txt")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port, debug=True)
