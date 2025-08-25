import os
import uuid
import datetime
import json
from flask import Flask, render_template, request, jsonify, Response
import openai
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# ===== 設定 =====
# (この部分は変更なし)
openai.api_key = os.environ["OPENAI_API_KEY"]
scope = ["https://spreadsheets.google.com/feeds","https://www.googleapis.com/auth/drive"]
creds_dict = {
    "type": os.environ["GCP_TYPE"],
    "project_id": os.environ["GCP_PROJECT_ID"],
    "private_key_id": os.environ["GCP_PRIVATE_KEY_ID"],
    "private_key": os.environ["GCP_PRIVATE_KEY"].replace("\\n", "\n"),
    "client_email": os.environ["GCP_CLIENT_EMAIL"],
    "client_id": os.environ["GCP_CLIENT_ID"],
    "auth_uri": os.environ["GCP_AUTH_URI"],
    "token_uri": os.environ["GCP_TOKEN_URI"],
    "auth_provider_x509_cert_url": os.environ["GCP_AUTH_PROVIDER_X509_CERT_URL"],
    "client_x509_cert_url": os.environ["GCP_CLIENT_X509_CERT_URL"]
}
creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
client = gspread.authorize(creds)
sheet_rooms = client.open("ChatLogs").worksheet("rooms")
sheet_msgs = client.open("ChatLogs").worksheet("messages")

app = Flask(__name__)

# ===== ユーティリティ =====

# ★★★ 変更点 1: translate_to_en 関数を完全に削除 ★★★
# (translate_to_en関数はここにあった)

def save_room(title):
    room_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    sheet_rooms.append_row([room_id, title, now, now])
    return room_id

# ★★★ 変更点 2: save_message 関数をシンプル化 ★★★
def save_message(room_id, role, content_ja):
    msg_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    # 英語訳のカラムには空文字("")を保存する
    sheet_msgs.append_row([msg_id, room_id, role, content_ja, "", now])
    return msg_id

# ===== APIエンドポイント =====
# (GET系とルーム作成のAPIは変更なし)
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/rooms", methods=["GET"])
def get_rooms():
    rows = sheet_rooms.get_all_values()[1:]
    data = [{"id": r[0], "title": r[1]} for r in rows]
    return jsonify(data)

@app.route("/rooms", methods=["POST"])
def create_room():
    title = request.json.get("title", "New Chat")
    room_id = save_room(title)
    return jsonify({"room_id": room_id})

@app.route("/rooms/<room_id>/messages", methods=["GET"])
def get_messages(room_id):
    rows = sheet_msgs.get_all_values()[1:]
    msgs = [r for r in rows if r[1] == room_id]
    data = [{"role": r[2], "content_ja": r[3]} for r in msgs]
    return jsonify(data)

# ★★★ 変更点 3: ユーザーメッセージ保存時の翻訳呼び出しを削除 ★★★
@app.route("/rooms/<room_id>/messages", methods=["POST"])
def post_user_message(room_id):
    prompt = request.json.get("prompt")
    # 翻訳をせずに日本語プロンプトのみ保存
    save_message(room_id, "user", prompt)
    return jsonify({"status": "ok"})

# ★★★ 変更点 4: ストリーム配信後の翻訳呼び出しを削除 ★★★
@app.route("/rooms/<room_id>/messages-stream", methods=["GET"])
def stream_messages(room_id):

    def generate():
        all_msgs_rows = sheet_msgs.get_all_values()[1:]
        past_msgs = [row for row in all_msgs_rows if row[1] == room_id]
        messages_history = [{"role": r[2], "content": r[3]} for r in past_msgs]

        full_response_ja = ""
        try:
            stream = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages_history,
                stream=True
            )
            for chunk in stream:
                content = chunk.choices[0].delta.content or ""
                if content:
                    full_response_ja += content
                    yield f"data: {json.dumps({'text': content})}\n\n"

            # AIの回答を翻訳せずに日本語のまま保存
            save_message(room_id, "assistant", full_response_ja)

        except Exception as e:
            error_message = f"エラーが発生しました: {type(e).__name__}"
            yield f"data: {json.dumps({'error': error_message})}\n\n"

    return Response(generate(), mimetype='text/event-stream')


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
