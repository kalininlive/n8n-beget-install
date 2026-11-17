# server.py (с поддержкой speech-with-timestamps)

from flask import Flask, request, send_file, jsonify, Response
from gevent.pywsgi import WSGIServer
from dotenv import load_dotenv
import os
import traceback
import json
import base64

from config import DEFAULT_CONFIGS
from handle_text import prepare_tts_input_with_context
from tts_handler import (
    generate_speech,
    generate_speech_stream,
    generate_speech_with_timestamps,
    get_models_formatted,
    get_voices,
    get_voices_formatted
)
from utils import getenv_bool, require_api_key, AUDIO_FORMAT_MIME_TYPES, DETAILED_ERROR_LOGGING

app = Flask(__name__)
load_dotenv()

API_KEY = os.getenv('API_KEY', DEFAULT_CONFIGS["API_KEY"])
PORT = int(os.getenv('PORT', str(DEFAULT_CONFIGS["PORT"])))

DEFAULT_VOICE = os.getenv('DEFAULT_VOICE', DEFAULT_CONFIGS["DEFAULT_VOICE"])
DEFAULT_RESPONSE_FORMAT = os.getenv('DEFAULT_RESPONSE_FORMAT', DEFAULT_CONFIGS["DEFAULT_RESPONSE_FORMAT"])
DEFAULT_SPEED = float(os.getenv('DEFAULT_SPEED', str(DEFAULT_CONFIGS["DEFAULT_SPEED"])))

REMOVE_FILTER = getenv_bool('REMOVE_FILTER', DEFAULT_CONFIGS["REMOVE_FILTER"])
EXPAND_API = getenv_bool('EXPAND_API', DEFAULT_CONFIGS["EXPAND_API"])

def generate_sse_audio_stream(text, voice, speed):
    try:
        for chunk in generate_speech_stream(text, voice, speed):
            encoded_audio = base64.b64encode(chunk).decode('utf-8')
            event_data = {
                "type": "speech.audio.delta",
                "audio": encoded_audio
            }
            yield f"data: {json.dumps(event_data)}\n\n"
        
        completion_event = {
            "type": "speech.audio.done",
            "usage": {
                "input_tokens": len(text.split()),
                "output_tokens": 0,
                "total_tokens": len(text.split())
            }
        }
        yield f"data: {json.dumps(completion_event)}\n\n"
    except Exception as e:
        print(f"Error during SSE streaming: {e}")
        error_event = {
            "type": "error",
            "error": str(e)
        }
        yield f"data: {json.dumps(error_event)}\n\n"

@app.route('/v1/audio/speech', methods=['POST'])
@app.route('/audio/speech', methods=['POST'])
@require_api_key
def text_to_speech():
    try:
        data = request.json
        if not data or 'input' not in data:
            return jsonify({"error": "Missing 'input' in request body"}), 400

        text = data.get('input')
        if not REMOVE_FILTER:
            text = prepare_tts_input_with_context(text)

        voice = data.get('voice', DEFAULT_VOICE)
        response_format = data.get('response_format', DEFAULT_RESPONSE_FORMAT)
        speed = float(data.get('speed', DEFAULT_SPEED))

        # Если запрошены таймкоды через флаг или verbose_json
        if data.get('with_timestamps') or data.get('timestamps') or response_format in ('verbose_json', 'json_timestamps'):
            result = generate_speech_with_timestamps(text, voice, speed)
            result["voice"] = voice
            result["speed"] = speed
            return jsonify(result)

        stream_format = data.get('stream_format', 'audio')
        mime_type = AUDIO_FORMAT_MIME_TYPES.get(response_format, "audio/mpeg")

        if stream_format == 'sse':
            def generate_sse():
                for event in generate_sse_audio_stream(text, voice, speed):
                    yield event
            return Response(
                generate_sse(),
                mimetype='text/event-stream',
                headers={
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                }
            )
        else:
            output_file_path = generate_speech(text, voice, response_format, speed)
            with open(output_file_path, 'rb') as audio_file:
                audio_data = audio_file.read()
            try:
                os.unlink(output_file_path)
            except OSError:
                pass
            return Response(
                audio_data,
                mimetype=mime_type,
                headers={
                    'Content-Type': mime_type,
                    'Content-Length': str(len(audio_data))
                }
            )
    except Exception as e:
        if DETAILED_ERROR_LOGGING:
            app.logger.error(f"Error in text_to_speech: {str(e)}\n{traceback.format_exc()}")
        else:
            app.logger.error(f"Error in text_to_speech: {str(e)}")
        return jsonify({"error": "An internal server error occurred", "details": str(e)}), 500

# Отдельный эндпоинт для генерации аудио с пословными таймкодами
@app.route('/v1/audio/speech-with-timestamps', methods=['POST'])
@app.route('/audio/speech-with-timestamps', methods=['POST'])
@require_api_key
def text_to_speech_with_timestamps():
    try:
        data = request.json
        if not data or 'input' not in data:
            return jsonify({"error": "Missing 'input' in request body"}), 400

        text = data.get('input')
        if not REMOVE_FILTER:
            text = prepare_tts_input_with_context(text)

        voice = data.get('voice', DEFAULT_VOICE)
        speed = float(data.get('speed', DEFAULT_SPEED))

        result = generate_speech_with_timestamps(text, voice, speed)
        result["voice"] = voice
        result["speed"] = speed
        return jsonify(result)
    except Exception as e:
        if DETAILED_ERROR_LOGGING:
            app.logger.error(f"Error in text_to_speech_with_timestamps: {str(e)}\n{traceback.format_exc()}")
        else:
            app.logger.error(f"Error in text_to_speech_with_timestamps: {str(e)}")
        return jsonify({"error": "An internal server error occurred", "details": str(e)}), 500

@app.route('/v1/models', methods=['GET', 'POST'])
@app.route('/models', methods=['GET', 'POST'])
@app.route('/v1/audio/models', methods=['GET', 'POST'])
@app.route('/audio/models', methods=['GET', 'POST'])
def list_models():
    return jsonify({"models": get_models_formatted()})

@app.route('/v1/audio/voices', methods=['GET', 'POST'])
@app.route('/audio/voices', methods=['GET', 'POST'])
def list_voices_formatted():
    return jsonify({"voices": get_voices_formatted()})

@app.route('/v1/voices', methods=['GET', 'POST'])
@app.route('/voices', methods=['GET', 'POST'])
@require_api_key
def list_voices():
    specific_language = None
    data = request.args if request.method == 'GET' else request.json
    if data and ('language' in data or 'locale' in data):
        specific_language = data.get('language') if 'language' in data else data.get('locale')
    return jsonify({"voices": get_voices(specific_language)})

@app.route('/v1/voices/all', methods=['GET', 'POST'])
@app.route('/voices/all', methods=['GET', 'POST'])
@require_api_key
def list_all_voices():
    return jsonify({"voices": get_voices('all')})

@app.route('/elevenlabs/v1/text-to-speech/<voice_id>', methods=['POST'])
@require_api_key
def elevenlabs_tts(voice_id):
    if not EXPAND_API:
        return jsonify({"error": "Endpoint not allowed"}), 500
    try:
        payload = request.json
        if not payload or 'text' not in payload:
            return jsonify({"error": "Missing 'text' in request body"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON payload: {str(e)}"}), 400

    text = payload['text']
    if not REMOVE_FILTER:
        text = prepare_tts_input_with_context(text)
    voice = voice_id
    response_format = 'mp3'
    speed = DEFAULT_SPEED
    try:
        output_file_path = generate_speech(text, voice, response_format, speed)
    except Exception as e:
        return jsonify({"error": f"TTS generation failed: {str(e)}"}), 500
    return send_file(output_file_path, mimetype="audio/mpeg", as_attachment=True, download_name="speech.mp3")

@app.route('/azure/cognitiveservices/v1', methods=['POST'])
@require_api_key
def azure_tts():
    if not EXPAND_API:
        return jsonify({"error": "Endpoint not allowed"}), 500
    try:
        ssml_data = request.data.decode('utf-8')
        if not ssml_data:
            return jsonify({"error": "Missing SSML payload"}), 400
        from xml.etree import ElementTree as ET
        root = ET.fromstring(ssml_data)
        text = root.find('.//{http://www.w3.org/2001/10/synthesis}voice').text
        voice = root.find('.//{http://www.w3.org/2001/10/synthesis}voice').get('name')
    except Exception as e:
        return jsonify({"error": f"Invalid SSML payload: {str(e)}"}), 400

    response_format = 'mp3'
    speed = DEFAULT_SPEED
    if not REMOVE_FILTER:
        text = prepare_tts_input_with_context(text)
    try:
        output_file_path = generate_speech(text, voice, response_format, speed)
    except Exception as e:
        return jsonify({"error": f"TTS generation failed: {str(e)}"}), 500
    return send_file(output_file_path, mimetype="audio/mpeg", as_attachment=True, download_name="speech.mp3")

print(" Edge TTS with Timestamps Server running on http://localhost:" + str(PORT))

if __name__ == '__main__':
    http_server = WSGIServer(('0.0.0.0', PORT), app)
    http_server.serve_forever()
