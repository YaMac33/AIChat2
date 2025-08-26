import os
import uuid
import datetime
import json
import io
from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_cors import CORS
import openai
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# =============================
# 初期設定
# =============================
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# --- OpenAI APIキーの設定 ---
# Renderなどの環境変数 "OPENAI_API_KEY" から読み込む
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("【警告】環境変数 'OPENAI_API_KEY' が設定されていません。AI機能は動作しません。")
else:
    openai.api_key = api_key

# --- Google Sheets APIキーの設定 ---
# Renderなどの環境変数からGCPの認証情報を読み込む
try:
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds_dict = {
        "type": os.environ.get("GCP_TYPE"),
        "project_id": os.environ.get("GCP_PROJECT_ID"),
        "private_key_id": os.environ.get("GCP_PRIVATE_KEY_ID"),
        "private_key": os.environ.get("GCP_PRIVATE_KEY", "").replace("\\n", "\n"),
        "client_email": os.environ.get("GCP_CLIENT_EMAIL"),
        "client_id": os.environ.get("GCP_CLIENT_ID"),
        "auth_uri": os.environ.get("GCP_AUTH_URI"),
        "token_uri": os.environ.get("GCP_TOKEN_URI"),
        "auth_provider_x509_cert_url": os.environ.get("GCP_AUTH_PROVIDER_X509_CERT_URL"),
        "client_x509_cert_url": os.environ.get("GCP_CLIENT_X509_CERT_URL")
    }
    creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
    client = gspread.authorize(creds)
    sheet_rooms = client.open("ChatLogs").worksheet("rooms")
    sheet_msgs = client.open("ChatLogs").worksheet("messages")
    print("Google Sheetsへの接続に成功しました。")
except Exception as e:
    print(f"【エラー】Google Sheetsへの接続に失敗しました: {e}")
    sheet_rooms = None
    sheet_msgs = None

# Render対応: 環境変数 PORT を取得
port = int(os.environ.get("PORT", 5000))

# =============================
# メインページ
# =============================
@app.route("/")
def index():
    return render_template("index.html")

# =============================
# データベース操作ヘルパー関数
# =============================
def save_message_to_sheet(room_id, role, content):
    """メッセージをスプレッドシートに保存する"""
    if not sheet_msgs:
        print("【エラー】メッセージシートが利用できないため、保存をスキップします。")
        return None
    msg_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    try:
        sheet_msgs.append_row([msg_id, room_id, role, content, now])
        return msg_id
    except Exception as e:
        print(f"メッセージの保存中にエラーが発生しました: {e}")
        return None

def get_messages_from_sheet(room_id):
    """指定されたルームのメッセージをスプレッドシートから取得する"""
    if not sheet_msgs:
        return []
    try:
        all_rows = sheet_msgs.get_all_records() # ヘッダーをキーにした辞書のリストで取得
        room_messages = [row for row in all_rows if row.get('room_id') == room_id]
        # content_ja のようなキーが存在しない場合も考慮
        return [
            {"role": msg.get('role'), "content_ja": msg.get('content_ja', msg.get('content'))}
            for msg in room_messages
        ]
    except Exception as e:
        print(f"メッセージの取得中にエラーが発生しました: {e}")
        return []

# =============================
# ルーム関連API (編集・削除機能も復活)
# =============================
@app.route("/rooms", methods=["GET"])
def get_rooms():
    if not sheet_rooms:
        return jsonify([])
    try:
        # created_atで降順ソートして返す
        rows = sorted(sheet_rooms.get_all_records(), key=lambda x: x.get('created_at', ''), reverse=True)
        data = [{"id": r.get('id'), "title": r.get('title'), "created_at": r.get('created_at')} for r in rows]
        return jsonify(data)
    except Exception as e:
        print(f"ルームの取得中にエラーが発生しました: {e}")
        return jsonify({"error": "Failed to fetch rooms"}), 500

@app.route("/rooms", methods=["POST"])
def create_room():
    if not sheet_rooms:
        return jsonify({"error": "Database not available"}), 500
    title = request.json.get("title", "新規チャット")
    room_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    try:
        new_room_data = {"id": room_id, "title": title, "created_at": now}
        sheet_rooms.append_row([new_room_data['id'], new_room_data['title'], new_room_data['created_at']])
        return jsonify(new_room_data)
    except Exception as e:
        print(f"ルームの作成中にエラーが発生しました: {e}")
        return jsonify({"error": "Failed to create room"}), 500

@app.route("/rooms/<room_id>", methods=["PUT"])
def update_room(room_id):
    if not sheet_rooms:
        return jsonify({"error": "Database not available"}), 500
    title = request.json.get("title")
    try:
        cell = sheet_rooms.find(room_id)
        if cell:
            sheet_rooms.update_cell(cell.row, 2, title) # 2列目(B列)がタイトルと仮定
            return jsonify({"status": "ok", "id": room_id, "title": title})
        return jsonify({"error": "not found"}), 404
    except Exception as e:
        print(f"ルーム名の変更中にエラーが発生しました: {e}")
        return jsonify({"error": "Failed to update room"}), 500

@app.route("/rooms/<room_id>", methods=["DELETE"])
def delete_room(room_id):
    if not sheet_rooms or not sheet_msgs:
        return jsonify({"error": "Database not available"}), 500
    try:
        # ルームを削除
        cell = sheet_rooms.find(room_id)
        if cell:
            sheet_rooms.delete_rows(cell.row)

        # 関連するメッセージを削除 (効率は悪いが確実な方法)
        all_msgs = sheet_msgs.get_all_records()
        rows_to_delete = [i + 2 for i, row in enumerate(all_msgs) if row.get('room_id') == room_id]
        # 後ろの行から削除しないとインデックスがずれる
        for row_index in sorted(rows_to_delete, reverse=True):
            sheet_msgs.delete_rows(row_index)

        return jsonify({"status": "deleted"})
    except gspread.exceptions.CellNotFound:
        return jsonify({"status": "deleted", "note": "Room already deleted or not found."})
    except Exception as e:
        print(f"ルームの削除中にエラーが発生しました: {e}")
        return jsonify({"error": "Failed to delete room"}), 500

# =============================
# メッセージ関連API
# =============================
@app.route("/rooms/<room_id>/messages", methods=["GET"])
def get_messages(room_id):
    messages = get_messages_from_sheet(room_id)
    return jsonify(messages)

@app.route("/rooms/<room_id>/messages", methods=["POST"])
def post_user_message(room_id):
    prompt = request.json.get("prompt")
    save_message_to_sheet(room_id, "user", prompt)
    return jsonify({"status": "ok"})

@app.route("/rooms/<room_id>/messages-stream")
def stream_messages(room_id):
    if not openai.api_key:
        def error_generate():
            yield f"data: {json.dumps({'text': 'エラー: OpenAI APIキーが設定されていません。', 'error': True})}\n\n"
            yield f"data: {json.dumps({'text': '', 'done': True})}\n\n"
        return Response(error_generate(), mimetype='text/event-stream')

    history = get_messages_from_sheet(room_id)
    api_messages = [{"role": msg["role"], "content": msg["content_ja"]} for msg in history]

    def generate():
        full_response_ja = ""
        try:
            stream = openai.ChatCompletion.create(
                model="gpt-5-nano",
                messages=api_messages,
                stream=True
            )
            for chunk in stream:
                content = chunk.choices[0].delta.get("content", "")
                if content:
                    full_response_ja += content
                    yield f"data: {json.dumps({'text': content})}\n\n"
        except Exception as e:
            error_message = f"APIエラー: {type(e).__name__}"
            print(f"OpenAI API Error: {e}")
            yield f"data: {json.dumps({'text': error_message, 'error': True})}\n\n"
        finally:
            if full_response_ja:
                save_message_to_sheet(room_id, "assistant", full_response_ja)
            yield f"data: {json.dumps({'text': '', 'done': True})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

# =============================
# 出力API (HTML / マニュアル機能も復活)
# =============================
@app.route("/rooms/<room_id>/export/html")
def export_html(room_id):
    messages = get_messages_from_sheet(room_id)
    html = "<html><head><meta charset='utf-8'><title>Chat Log</title></head><body>"
    html += f"<h1>チャットルーム履歴</h1>"
    for m in messages:
        role = "ユーザー" if m["role"] == "user" else "アシスタント"
        content = m["content_ja"].replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
        html += f"<p><b>{role}</b>: {content}</p>"
    html += "</body></html>"
    buf = io.BytesIO(html.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, mimetype="text/html", as_attachment=True, download_name=f"chat_{room_id}.html")

@app.route("/rooms/<room_id>/export/manual")
def export_manual(room_id):
    messages = get_messages_from_sheet(room_id)
    text = f"### チャットルーム {room_id} の記録\n\n"
    for m in messages:
        role = "ユーザー" if m["role"] == "user" else "アシスタント"
        text += f"**{role}**: {m['content_ja']}\n\n---\n\n"
    buf = io.BytesIO(text.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, mimetype="text/plain", as_attachment=True, download_name=f"manual_{room_id}.txt")

# =============================
# アプリケーションの起動
# =============================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port, debug=True)
