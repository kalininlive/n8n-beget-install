# tts_handler.py (с поддержкой пословных таймкодов)

import edge_tts
import asyncio
import tempfile
import subprocess
import os
import base64
from pathlib import Path

from utils import DETAILED_ERROR_LOGGING
from config import DEFAULT_CONFIGS

DEFAULT_LANGUAGE = os.getenv('DEFAULT_LANGUAGE', DEFAULT_CONFIGS["DEFAULT_LANGUAGE"])

voice_mapping = {
    'alloy': 'en-US-JennyNeural',
    'ash': 'en-US-AndrewNeural',
    'ballad': 'en-GB-ThomasNeural',
    'coral': 'en-AU-NatashaNeural',
    'echo': 'en-US-GuyNeural',
    'fable': 'en-GB-SoniaNeural',
    'nova': 'en-US-AriaNeural',
    'onyx': 'en-US-EricNeural',
    'sage': 'en-US-JennyNeural',
    'shimmer': 'en-US-EmmaNeural',
    'verse': 'en-US-BrianNeural',
}

model_data = [
    {"id": "tts-1", "name": "Text-to-speech v1"},
    {"id": "tts-1-hd", "name": "Text-to-speech v1 HD"},
    {"id": "gpt-4o-mini-tts", "name": "GPT-4o mini TTS"}
]

def is_ffmpeg_installed():
    try:
        subprocess.run(['ffmpeg', '-version'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def speed_to_rate(speed: float) -> str:
    if speed < 0 or speed > 2:
        raise ValueError("Speed must be between 0 and 2 (inclusive).")
    percentage_change = (speed - 1) * 100
    return f"{percentage_change:+.0f}%"

async def _generate_audio_stream(text, voice, speed):
    edge_tts_voice = voice_mapping.get(voice, voice)
    try:
        speed_rate = speed_to_rate(speed)
    except Exception as e:
        print(f"Error converting speed: {e}. Defaulting to +0%.")
        speed_rate = "+0%"
    communicator = edge_tts.Communicate(text=text, voice=edge_tts_voice, rate=speed_rate)
    async for chunk in communicator.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]

def generate_speech_stream(text, voice, speed=1.0):
    return asyncio.run(_generate_audio_stream(text, voice, speed))

async def _generate_audio(text, voice, response_format, speed):
    edge_tts_voice = voice_mapping.get(voice, voice)
    temp_mp3_file_obj = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    temp_mp3_path = temp_mp3_file_obj.name

    try:
        speed_rate = speed_to_rate(speed)
    except Exception as e:
        print(f"Error converting speed: {e}. Defaulting to +0%.")
        speed_rate = "+0%"

    communicator = edge_tts.Communicate(text=text, voice=edge_tts_voice, rate=speed_rate)
    await communicator.save(temp_mp3_path)
    temp_mp3_file_obj.close()

    if response_format == "mp3":
        return temp_mp3_path

    if not is_ffmpeg_installed():
        print("FFmpeg is not available. Returning unmodified mp3 file.")
        return temp_mp3_path

    converted_file_obj = tempfile.NamedTemporaryFile(delete=False, suffix=f".{response_format}")
    converted_path = converted_file_obj.name
    converted_file_obj.close()

    ffmpeg_command = [
        "ffmpeg",
        "-i", temp_mp3_path,
        "-c:a", {
            "aac": "aac",
            "mp3": "libmp3lame",
            "wav": "pcm_s16le",
            "opus": "libopus",
            "flac": "flac"
        }.get(response_format, "aac"),
    ]

    if response_format != "wav":
        ffmpeg_command.extend(["-b:a", "192k"])

    ffmpeg_command.extend([
        "-f", {
            "aac": "mp4",
            "mp3": "mp3",
            "wav": "wav",
            "opus": "ogg",
            "flac": "flac"
        }.get(response_format, response_format),
        "-y",
        converted_path
    ])

    try:
        subprocess.run(ffmpeg_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        Path(converted_path).unlink(missing_ok=True)
        Path(temp_mp3_path).unlink(missing_ok=True)
        if DETAILED_ERROR_LOGGING:
            error_message = f"FFmpeg error: {' '.join(e.cmd)}. Stderr: {e.stderr.decode('utf-8', 'ignore')}"
            print(error_message)
        else:
            error_message = f"FFmpeg error: {e}"
            print(error_message)
        raise RuntimeError(f"FFmpeg error: {e}")

    Path(temp_mp3_path).unlink(missing_ok=True)
    return converted_path

def generate_speech(text, voice, response_format, speed=1.0):
    return asyncio.run(_generate_audio(text, voice, response_format, speed))

# === ПОСЛОВНЫЕ ТАЙМКОДЫ И СУБТИТРЫ ===
async def _generate_audio_with_timestamps(text, voice, speed):
    edge_tts_voice = voice_mapping.get(voice, voice)
    try:
        speed_rate = speed_to_rate(speed)
    except Exception as e:
        print(f"Error converting speed: {e}. Defaulting to +0%.")
        speed_rate = "+0%"

    last_error = None
    for attempt in range(3):
        try:
            communicator = edge_tts.Communicate(text=text, voice=edge_tts_voice, rate=speed_rate, boundary="WordBoundary")
            submaker = edge_tts.SubMaker()
            words = []
            audio_chunks = []

            async for chunk in communicator.stream():
                if chunk["type"] == "audio":
                    audio_chunks.append(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    submaker.feed(chunk)
                    start_sec = chunk["offset"] / 10_000_000
                    dur_sec = chunk["duration"] / 10_000_000
                    words.append({
                        "word": chunk["text"],
                        "start": round(start_sec, 3),
                        "end": round(start_sec + dur_sec, 3),
                        "duration": round(dur_sec, 3)
                    })

            audio_data = b"".join(audio_chunks)
            if not audio_data:
                raise RuntimeError("Empty audio stream received")

            srt_content = submaker.get_srt()
            vtt_content = ("WEBVTT\n\n" + srt_content.replace(",", ".")) if srt_content else "WEBVTT\n"
            total_dur = words[-1]["end"] if words else 0.0

            return {
                "audio_base64": base64.b64encode(audio_data).decode("ascii"),
                "audio_size_bytes": len(audio_data),
                "duration": round(total_dur, 3),
                "words_count": len(words),
                "srt": srt_content,
                "vtt": vtt_content,
                "words": words
            }
        except Exception as e:
            last_error = e
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))

    raise last_error

def generate_speech_with_timestamps(text, voice, speed=1.0):
    return asyncio.run(_generate_audio_with_timestamps(text, voice, speed))

def get_models():
    return model_data

def get_models_formatted():
    return [{ "id": x["id"] } for x in model_data]

def get_voices_formatted():
    return [{ "id": k, "name": v } for k, v in voice_mapping.items()]

async def _get_voices(language=None):
    all_voices = await edge_tts.list_voices()
    language = language or DEFAULT_LANGUAGE
    filtered_voices = [
        {"name": v['ShortName'], "gender": v['Gender'], "language": v['Locale']}
        for v in all_voices if language == 'all' or language is None or v['Locale'] == language
    ]
    return filtered_voices

def get_voices(language=None):
    return asyncio.run(_get_voices(language))
