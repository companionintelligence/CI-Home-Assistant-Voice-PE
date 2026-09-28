"""
Wyoming event handler: one instance per TCP connection from Home Assistant.

Home Assistant opens a short-lived connection per request and sends one of:

  describe                                   -> info
  transcribe, audio-start, audio-chunk..., audio-stop -> transcript     (STT)
  synthesize                                 -> audio-start, audio-chunk..., audio-stop (TTS)
  transcript                                 -> handled | not-handled   (conversation)
"""
from __future__ import annotations

import logging
from typing import Optional

from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioChunkConverter, AudioStart, AudioStop
from wyoming.error import Error
from wyoming.event import Event
from wyoming.handle import Handled, NotHandled
from wyoming.info import Describe, Info
from wyoming.server import AsyncEventHandler
from wyoming.tts import Synthesize

from src.audio.processing import STT_CHANNELS, STT_RATE, STT_WIDTH, chunk_pcm, pcm_to_wav, wav_to_pcm
from src.client.ci_client import CIClient
from src.config import BridgeConfig
from src.conversation import ConversationStore

logger = logging.getLogger("voice-bridge.wyoming")

SORRY = "Sorry, I could not reach Companion Intelligence right now."


class CompanionEventHandler(AsyncEventHandler):
    def __init__(
        self,
        info: Info,
        config: BridgeConfig,
        client: CIClient,
        conversations: ConversationStore,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._info_event = info.event()
        self._config = config
        self._client = client
        self._conversations = conversations
        self._language: Optional[str] = None
        self._converter = AudioChunkConverter(rate=STT_RATE, width=STT_WIDTH, channels=STT_CHANNELS)
        self._audio = bytearray()
        self._recording = False
        self._truncated = False

    async def handle_event(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            await self.write_event(self._info_event)
            return True

        if Transcribe.is_type(event.type):
            self._language = Transcribe.from_event(event).language or self._language
            return True

        if AudioStart.is_type(event.type):
            self._audio.clear()
            self._recording = True
            self._truncated = False
            return True

        if AudioChunk.is_type(event.type):
            if self._recording:
                self._append_audio(AudioChunk.from_event(event))
            return True

        if AudioStop.is_type(event.type):
            if self._recording:
                self._recording = False
                await self._finish_transcription()
            return True

        if Synthesize.is_type(event.type):
            await self._synthesize(Synthesize.from_event(event))
            return True

        if Transcript.is_type(event.type):
            await self._handle_transcript(Transcript.from_event(event))
            return True

        logger.debug("Ignoring unexpected event: %s", event.type)
        return True

    # ------------------------------------------------------------------ STT

    def _append_audio(self, chunk: AudioChunk) -> None:
        pcm = self._converter.convert(chunk).audio
        room = self._config.max_audio_bytes - len(self._audio)
        if room <= 0:
            if not self._truncated:
                logger.warning("Utterance exceeded %d bytes; dropping the rest", self._config.max_audio_bytes)
                self._truncated = True
            return
        self._audio.extend(pcm[:room])

    async def _finish_transcription(self) -> None:
        language = self._language or self._config.languages[0]
        pcm = bytes(self._audio)
        self._audio.clear()
        if not pcm:
            await self.write_event(Transcript(text="", language=language).event())
            return
        try:
            text = await self._client.transcribe(pcm_to_wav(pcm), language=language)
        except Exception as exc:  # noqa: BLE001 - report every failure back to HA
            logger.error("Transcription failed: %s", exc)
            await self.write_event(Error(text=f"Transcription failed: {exc}", code="stt-error").event())
            return
        logger.info("Transcript: %r", text)
        await self.write_event(Transcript(text=text.strip(), language=language).event())

    # ------------------------------------------------------------------ TTS

    async def _synthesize(self, request: Synthesize) -> None:
        voice = request.voice.name if request.voice and request.voice.name else None
        try:
            wav = await self._client.synthesize(request.text, voice=voice)
            decoded = wav_to_pcm(wav)
        except Exception as exc:  # noqa: BLE001
            logger.error("Speech synthesis failed: %s", exc)
            await self.write_event(Error(text=f"Speech synthesis failed: {exc}", code="tts-error").event())
            return

        fmt = dict(rate=decoded.rate, width=decoded.width, channels=decoded.channels)
        await self.write_event(AudioStart(**fmt).event())
        for chunk in chunk_pcm(decoded.pcm, decoded.width, decoded.channels):
            await self.write_event(AudioChunk(audio=chunk, **fmt).event())
        await self.write_event(AudioStop().event())

    # ---------------------------------------------------------- conversation

    async def _handle_transcript(self, transcript: Transcript) -> None:
        text = transcript.text.strip()
        context = dict(transcript.context or {})
        conversation_id = context.get("conversation_id")
        if not text:
            await self.write_event(NotHandled(text="I did not catch that.", context=context).event())
            return

        messages = self._conversations.history(conversation_id)
        messages.append({"role": "user", "content": text})
        try:
            reply = (
                await self._client.respond(
                    messages,
                    instructions=self._config.system_instructions,
                    session_id=conversation_id,
                )
            ).strip()
        except Exception as exc:  # noqa: BLE001
            logger.error("Conversation request failed: %s", exc)
            await self.write_event(NotHandled(text=SORRY, context=context).event())
            return

        if not reply:
            await self.write_event(NotHandled(text=SORRY, context=context).event())
            return

        context["conversation_id"] = self._conversations.record(conversation_id, text, reply)
        logger.info("Reply: %r", reply[:120])
        await self.write_event(Handled(text=reply, context=context).event())
