

 
import os
import uuid
import boto3
import requests
import whisper
import tempfile
import subprocess
 
import speech_recognition as sr
from pydub import AudioSegment
import io
 
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
import pytesseract
from PyPDF2 import PdfReader
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Users\kartik.sidana\Documents\Tesseract-OCR\tesseract.exe"
os.environ["TESSDATA_PREFIX"] = r"C:\Users\kartik.sidana\Documents\Tesseract-OCR\tessdata"
 
# -------------------------
# LOAD ENV
# -------------------------
load_dotenv()
 
AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION")
API_GATEWAY_URL = os.getenv("API_GATEWAY_URL")
 
app = Flask(__name__)
 
CORS(app, resources={r"/*": {"origins": "*"}})
# -------------------------
# AWS CLIENTS
# -------------------------
dynamodb = boto3.resource(
    "dynamodb",
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=AWS_REGION
)
 
table = dynamodb.Table("DocumentText")
 
# Add this at the top with other tables
conv_table = dynamodb.Table("ConversationHistory")
 
# ── HELPER: get history ──
def get_history(session_id):
    try:
        res = conv_table.get_item(Key={"session_id": session_id})
        if "Item" in res:
            return res["Item"]
        return {"summary": "", "recent": []}
    except:
        return {"summary": "", "recent": []}
 
 
# ── HELPER: save history ──
def save_history(session_id, summary, recent):
    conv_table.put_item(Item={
        "session_id": session_id,
        "summary": summary,
        "recent": recent  # always only last 2 messages (1 exchange)
    })
 
 
# ── HELPER: update summary after every exchange ──
def update_summary(old_summary, user_msg, bot_reply):
    """
    After every exchange, compress everything into
    one updated running summary using Bedrock.
    """
    prompt = f"""
    You are a memory manager for an AI assistant.
   
    Your job is to maintain a RUNNING SUMMARY of a conversation.
   
    EXISTING SUMMARY (what happened before):
    {old_summary if old_summary else "No previous conversation."}
   
    NEW EXCHANGE JUST HAPPENED:
    User: {user_msg}
    Assistant: {bot_reply}
   
    Update the summary to include this new exchange.
   
    RULES:
    - Keep summary under 200 words
    - Preserve all important facts, topics, decisions
    - Write in third person (e.g. "The user asked about...")
    - Be concise but don't lose key details
   
    UPDATED SUMMARY:
    """
 
    try:
        res = requests.post(API_GATEWAY_URL, json={"message": prompt})
        return res.json().get("response", old_summary)
    except:
        return old_summary  # if summarization fails, keep old summary
 
# -------------------------
# TEXT CHAT
# -------------------------
 
@app.route("/text", methods=["POST"])
def text_chat():
    try:
        data = request.json
        user_text = data.get("message", "")
        session_id = data.get("session_id", "default")
 
        # Fetch summary + last exchange
        history = get_history(session_id)
        summary = history.get("summary", "")
        recent = history.get("recent", [])
 
        # Build recent text (only last 1 exchange = 2 messages)
        recent_text = ""
        for msg in recent:
            role = "User" if msg["role"] == "user" else "Assistant"
            recent_text += f"{role}: {msg['content']}\n"
 
        # Build prompt — summary + last exchange + new question
        prompt = f"""
        You are Friday, a helpful AI assistant.
 
        CONVERSATION SUMMARY SO FAR:
        {summary if summary else "This is the start of the conversation."}
 
        MOST RECENT EXCHANGE:
        {recent_text if recent_text else "No previous exchange yet."}
 
        Now respond to the user's new message.
 
        User: {user_text}
        Assistant:"""
 
        # Call Bedrock
        # res = requests.post(API_GATEWAY_URL, json={
        #     "message": prompt,
        #     "session_id": session_id   # ← add this
        # })
        # bot_reply = res.json().get("response", "")
        # Call Bedrock
        res = requests.post(
            API_GATEWAY_URL,
            json={
                "message": prompt,
                "session_id": session_id
            },
            timeout=120
        )
 
        response_json = res.json()
 
        print("RAW API RESPONSE:", response_json)
 
        bot_reply = (
            response_json.get("response")
            or response_json.get("body")
            or response_json.get("message")
            or ""
        )
 
        bot_reply = str(bot_reply).strip()
 
        if not bot_reply:
            bot_reply = "I could not generate a response."
 
        # Update running summary in background
        updated_summary = update_summary(summary, user_text, bot_reply)
 
        # Save: updated summary + this exchange as new recent
        save_history(
            session_id,
            summary=updated_summary,
            recent=[
                {"role": "user",      "content": user_text},
                {"role": "assistant", "content": bot_reply}
            ]
        )
 
        return jsonify({"response": bot_reply})
 
    except Exception as e:
        print(f"TEXT ERROR: {str(e)}")
        return jsonify({"response": f"Server error: {str(e)}"}), 500
 
 
# -------------------------
# PROCESS FILE (NEW CORE)
# -------------------------
 
@app.route("/process-file", methods=["POST"])
def process_file():
    file = request.files["file"]
    text = ""
    filename = file.filename.lower()
 
    # IMAGE OCR
    if filename.endswith((".png", ".jpg", ".jpeg")):
        try:
            img = Image.open(file)
            img = img.convert("RGB")
            img = img.resize((800, 800))
            text = pytesseract.image_to_string(img)
        except Exception as e:
            print("IMAGE ERROR:", str(e))
            return jsonify({"error": str(e)}), 500
 
    # PDF
    elif filename.endswith(".pdf"):
        reader = PdfReader(file)
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted
 
    if not text.strip():
        return jsonify({"error": "No text extracted from file"}), 400
 
    # GENERATE BASE KEY
    key = f"doc-{uuid.uuid4()}"
 
    # SPLIT INTO CHUNKS OF 4000 CHARS
    chunk_size = 4000
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
 
    # STORE EACH CHUNK IN DYNAMODB
    for idx, chunk in enumerate(chunks):
        table.put_item(
            Item={
                "doc_key": f"{key}#chunk#{idx}",
                "text": chunk,
                "base_key": key,
                "chunk_index": idx,
                "total_chunks": len(chunks)
            }
        )
 
    # STORE METADATA ENTRY
    table.put_item(
        Item={
            "doc_key": key,
            "text": "__meta__",
            "total_chunks": len(chunks)
        }
    )
 
    print(f"Stored {len(chunks)} chunks for key: {key}")
    return jsonify({"key": key, "chunks": len(chunks)})
 
 
# -------------------------
# ASK DOCUMENT
# -------------------------
 
@app.route("/ask-doc", methods=["POST"])
def ask_doc():
    try:
        data = request.json
        key = data.get("key")
        question = data.get("question")
        session_id = data.get("session_id", "default")
 
        if not key:
            return jsonify({"response": "No document key. Please re-upload."}), 400
 
        # Fetch summary + last exchange
        history = get_history(session_id)
        summary = history.get("summary", "")
        recent = history.get("recent", [])
 
        recent_text = ""
        for msg in recent:
            role = "User" if msg["role"] == "user" else "Assistant"
            recent_text += f"{role}: {msg['content']}\n"
 
        # Fetch document chunks
        meta = table.get_item(Key={"doc_key": key})
        if "Item" not in meta:
            return jsonify({"response": "Document not found"}), 404
 
        total_chunks = int(meta["Item"].get("total_chunks", 1))
        full_text = ""
        for idx in range(total_chunks):
            chunk_res = table.get_item(Key={"doc_key": f"{key}#chunk#{idx}"})
            if "Item" in chunk_res:
                full_text += chunk_res["Item"]["text"] + "\n"
 
        max_context = 40000
        if len(full_text) > max_context:
            full_text = full_text[:max_context]
 
        # Build prompt
        prompt = f"""
        You are Friday, a helpful AI assistant.
 
        CONVERSATION SUMMARY SO FAR:
        {summary if summary else "This is the start of the conversation."}
 
        MOST RECENT EXCHANGE:
        {recent_text if recent_text else "No previous exchange yet."}
 
        DOCUMENT:
        \"\"\"
        {full_text}
        \"\"\"
 
        RULES:
        - Answer ONLY using the document
        - Use summary and recent exchange for follow-up context
        - Return FULL lists, never truncate
        - If not in document say "Answer not found in document"
 
        User: {question}
        Assistant:"""
 
        # res = requests.post(API_GATEWAY_URL, json={"message": prompt})
        res = requests.post(API_GATEWAY_URL, json={
            "message": prompt,
            "session_id": session_id   # ← add this
        })
        bot_reply = res.json().get("response", "")
 
        # Update running summary
        updated_summary = update_summary(summary, question, bot_reply)
 
        # Save updated state
        save_history(
            session_id,
            summary=updated_summary,
            recent=[
                {"role": "user",      "content": question},
                {"role": "assistant", "content": bot_reply}
            ]
        )
 
        return jsonify({"response": bot_reply})
 
    except Exception as e:
        print(f"ASK-DOC ERROR: {str(e)}")
        return jsonify({"response": f"Server error: {str(e)}"}), 500
 
 
# ── CLEAR MEMORY ──
@app.route("/clear-memory", methods=["POST"])
def clear_memory():
    session_id = request.json.get("session_id", "default")
    conv_table.delete_item(Key={"session_id": session_id})
    return jsonify({"status": "cleared"})
 
 
# -------------------------
if __name__ == "__main__":
    app.run(port=5000, debug=True)
 