"""
Voice Bridge main entry point.

Listens for Wyoming WebSocket connections from Home Assistant,
buffers audio, performs VAD, calls ci-server for STT/LLM/TTS,
and returns audio responses back to HA.

Usage:
  VOICE_BRIDGE_HOST=0.0.0.0 VOICE_BRIDGE_PORT=10700 python -m voice_bridge.main
"""
from __future__ import annotations

import asyncio
import logging
import os

import websockets
from websockets.server import WebSocketServerProtocol

from src.audio.processing import RingBuffer, VoiceActivityDetector, pcm_to_wav
from src.client.ci_client import synthesize_speech, transcribe, stream_responses
from src.wyoming.protocol import WyomingMessage, transcript, error as wyoming_error

logging.basicConfig(
    level=logging.DEBUG if os.environ.get("DEBUG") else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice-bridge")

SAMPLE_RATE = int(os.environ.get("SAMPLE_RATE", "16000"))
BRIDGE_HOST = os.environ.get("VOICE_BRIDGE_HOST", "0.0.0.0")
BRIDGE_PORT = int(os.environ.get("VOICE_BRIDGE_PORT", "10700"))
SYSTEM_INSTRUCTIONS = os.environ.get(
    "SYSTEM_INSTRUCTIONS", "You are a concise smart home voice assistant."
)


async def handle_connection(ws: WebSocketServerProtocol, path: str) -> None:
    """Handle a single Wyoming WebSocket connection from HA."""
    logger.info("New Wyoming connection from %s (path=%s)", ws.remote_address, path)

    ring_buf = RingBuffer()
    vad = VoiceActivityDetector()
    sample_rate = SAMPLE_RATE

    try:
        async for raw in ws:
            if isinstance(raw, bytes):
                # Binary frame → raw PCM audio chunk
                ring_buf.push(raw)
                speech_active = vad.process(raw)

                if not speech_active and len(ring_buf) > 0:
                    # VAD detected end of utterance → process
                    frames = ring_buf.drain()
                    vad.reset()
                    logger.debug("VAD end: %d frames captured", len(frames))
                    await _process_utterance(ws, frames, sample_rate, None)

            elif isinstance(raw, str):
                msg = WyomingMessage.from_json(raw)
                logger.debug("Wyoming msg: %s", msg.type)

                if msg.type == "audio-start":
                    sample_rate = msg.data.get("rate", SAMPLE_RATE)
                    ring_buf = RingBuffer()
                    vad.reset()
                    logger.info("Audio stream started, rate=%d", sample_rate)

                elif msg.type == "audio-chunk" and msg.payload:
                    ring_buf.push(msg.payload)
                    vad.process(msg.payload)

                elif msg.type == "audio-stop":
                    # Explicit stream end → flush whatever we have
                    if not ring_buf.is_empty:
                        frames = ring_buf.drain()
                        vad.reset()
                        logger.debug("audio-stop: flushing %d frames", len(frames))
                        await _process_utterance(ws, frames, sample_rate, None)

    except websockets.exceptions.ConnectionClosed:
        logger.info("Wyoming connection closed")
    except Exception as exc:
        logger.error("Unhandled error in Wyoming handler: %s", exc, exc_info=True)
        try:
            await ws.send(wyoming_error(str(exc)).to_json())
        except Exception:
            pass


async def _process_utterance(
    ws: WebSocketServerProtocol,
    frames: list[bytes],
    sample_rate: int,
    previous_response_id: str | None,
) -> None:
    """
    Full pipeline for one user utterance:
      PCM frames → WAV → STT → LLM (streaming) → TTS → send audio back
    """
    try:
        # 1. PCM → WAV
        wav_bytes = pcm_to_wav(frames, sample_rate=sample_rate)
        logger.debug("WAV size: %d bytes", len(wav_bytes))

        # 2. STT
        text = await transcribe(wav_bytes)
        logger.info("Transcript: %r", text)
        if not text.strip():
            return

        # Send interim transcript back to HA
        await ws.send(transcript(text, is_final=True).to_json())

        # 3. LLM (streaming) – collect full response
        full_response = ""
        async for delta in stream_responses(
            text,
            instructions=SYSTEM_INSTRUCTIONS,
            previous_response_id=previous_response_id,
        ):
            full_response += delta

        logger.info("LLM response: %r", full_response[:120])

        # 4. TTS – synthesize speech and send back as binary frames
        if full_response.strip():
            audio_bytes = await synthesize_speech(full_response)
            if audio_bytes:
                # Send as a single binary frame; HA Voice Bridge / ESPHome handles playback
                await ws.send(audio_bytes)

    except Exception as exc:
        logger.error("Pipeline error: %s", exc, exc_info=True)
        try:
            await ws.send(wyoming_error(f"Pipeline error: {exc}").to_json())
        except Exception:
            pass


async def main() -> None:
    logger.info(
        "Starting Voice Bridge on ws://%s:%d", BRIDGE_HOST, BRIDGE_PORT
    )
    async with websockets.serve(handle_connection, BRIDGE_HOST, BRIDGE_PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
