"""
Wyoming event handler: one instance per TCP connection from Home Assistant.

Home Assistant opens a short-lived connection per request and sends one of:

  describe                                   -> info
  transcribe, audio-start, audio-chunk..., audio-stop -> transcript     (STT)
  synthesize                                 -> audio-start, audio-chunk..., audio-stop (TTS)
  transcript                                 -> handled | not-handled   (conversation)

Every error event is followed by closing the connection. In the Home Assistant
releases checked from 2025.10 through 2026.7 the STT and TTS clients never look at an
error event: they only stop reading on a transcript, on audio-stop or on end of
stream, with no timeout of their own, so a bridge that went quiet after an error
would hang the pipeline. The releases checked from 2026.8 (2026.8.3, 2026.9.4) do
read the error and stop, and a close after it is harmless there.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioChunkConverter, AudioStart, AudioStop
from wyoming.error import Error
from wyoming.event import Event, async_read_event
from wyoming.handle import Handled, NotHandled
from wyoming.info import Describe, Info
from wyoming.server import AsyncEventHandler
from wyoming.tts import Synthesize

from src.audio.processing import STT_CHANNELS, STT_RATE, STT_WIDTH, chunk_pcm, pcm_to_wav, wav_to_pcm
from src.client.ci_client import (
    AUTH,
    BAD_RESPONSE,
    RATE_LIMIT,
    TIMEOUT,
    UNREACHABLE,
    CIClient,
    classify,
)
from src.config import BridgeConfig
from src.conversation import ConversationStore
from src.wyoming.info import restrict_info

logger = logging.getLogger("voice-bridge.wyoming")

SORRY = "Sorry, I could not reach Companion Intelligence right now."

# What Home Assistant speaks when a conversation request fails, by cause.
SPOKEN = {
    AUTH: "Sorry, Companion Intelligence did not accept my API key. Please check the voice bridge settings.",
    RATE_LIMIT: "Sorry, Companion Intelligence is busy right now. Please try again in a moment.",
    TIMEOUT: "Sorry, Companion Intelligence took too long to answer.",
    UNREACHABLE: SORRY,
    BAD_RESPONSE: "Sorry, Companion Intelligence sent back something I could not understand.",
}

# These mean the client is gone (Home Assistant cancelled the pipeline, or the bridge is
# stopping) and there is nobody left to send an error to.
_CLIENT_GONE = (ConnectionError, asyncio.IncompleteReadError)


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
        self._info = info
        self._info_event = info.event()
        self._config = config
        self._client = client
        self._conversations = conversations
        self._language: Optional[str] = None
        self._converter = AudioChunkConverter(rate=STT_RATE, width=STT_WIDTH, channels=STT_CHANNELS)
        self._audio = bytearray()
        self._recording = False
        self._truncated = False

    async def run(self) -> None:
        """
        AsyncEventHandler.run (wyoming 1.10.2), except that a frame wyoming cannot parse
        (no type, a JSON list, a non-numeric length) is answered with an error event and a
        close rather than ending the task with an exception nobody retrieves.
        """
        self._is_running = True
        try:
            while self._is_running:
                try:
                    event = await async_read_event(self.reader)
                except Exception as exc:  # noqa: BLE001 - anything a client can put on the wire
                    if not isinstance(exc, _CLIENT_GONE):
                        logger.warning("Could not read an event from the client: %s", type(exc).__name__)
                        await self._send_error("Could not read the event", "invalid-event")
                    break
                if event is None:
                    break
                if not await self.handle_event(event):
                    break
        finally:
            await self.disconnect()
            self.writer.close()

    async def handle_event(self, event: Event) -> bool:
        try:
            return await self._dispatch(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a bad event must not end the task with a traceback
            # Python 3.12 reports a write to a closed transport as a TypeError or an
            # AttributeError, not a ConnectionError, so also ask the transport.
            if isinstance(exc, _CLIENT_GONE) or self.writer.is_closing():
                logger.info("Client went away while handling %s", event.type)
                return False
            # Only the event type and the exception class: the message can echo what was sent,
            # so the full traceback is left for when transcripts may be logged.
            logger.warning("Could not handle %s event: %s", event.type, type(exc).__name__)
            if self._config.log_transcripts:
                logger.debug("Details of the failure above", exc_info=True)
            text = f"Could not handle the {event.type} event ({type(exc).__name__})"
            return await self._send_error(text, "invalid-event")

    async def _dispatch(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            if not self._config.hide_unconfigured_speech:
                # The default: the same three programs every time, and no call to ci-server.
                await self.write_event(self._info_event)
                return True
            stt, tts = await self._client.speech_available()
            await self.write_event(restrict_info(self._info, stt=stt, tts=tts).event())
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
                return await self._finish_transcription()
            return True

        if Synthesize.is_type(event.type):
            return await self._synthesize(Synthesize.from_event(event))

        if Transcript.is_type(event.type):
            await self._handle_transcript(Transcript.from_event(event))
            return True

        logger.debug("Ignoring unexpected event: %s", event.type)
        return True

    async def _send_error(self, text: str, code: str) -> bool:
        """Write an error event and return False, which makes the server close the connection."""
        try:
            await self.write_event(Error(text=text, code=code).event())
        except Exception:  # noqa: BLE001 - a courtesy to the client; the connection closes either way
            logger.debug("Could not send the error event", exc_info=True)
        return False

    def _failure(self, exc: BaseException) -> tuple[str, str]:
        """The cause of a failed ci-server call and a description that is never empty."""
        kind = classify(exc)
        if str(exc):
            return kind, str(exc)
        if kind == TIMEOUT:
            return kind, f"timed out after {self._config.request_timeout_s:g}s"
        return kind, type(exc).__name__

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

    async def _finish_transcription(self) -> bool:
        language = self._language or self._config.languages[0]
        pcm = bytes(self._audio)
        self._audio.clear()
        if not pcm:
            await self.write_event(Transcript(text="", language=language).event())
            return True
        try:
            text = await self._client.transcribe(pcm_to_wav(pcm), language=language)
        except Exception as exc:  # noqa: BLE001 - report every failure back to HA
            kind, detail = self._failure(exc)
            logger.error("Transcription failed (%s): %s", kind, detail)
            return await self._send_error(f"Transcription failed ({kind}): {detail}", "stt-error")
        if self._config.log_transcripts:
            logger.info("Transcript: %r", text)
        else:
            logger.info("Transcript received (%d characters)", len(text.strip()))
        await self.write_event(Transcript(text=text.strip(), language=language).event())
        return True

    # ------------------------------------------------------------------ TTS

    async def _synthesize(self, request: Synthesize) -> bool:
        voice = request.voice.name if request.voice and request.voice.name else None
        try:
            wav = await self._client.synthesize(request.text, voice=voice)
            decoded = wav_to_pcm(wav)
        except Exception as exc:  # noqa: BLE001
            kind, detail = self._failure(exc)
            logger.error("Speech synthesis failed (%s): %s", kind, detail)
            return await self._send_error(f"Speech synthesis failed ({kind}): {detail}", "tts-error")

        fmt = dict(rate=decoded.rate, width=decoded.width, channels=decoded.channels)
        await self.write_event(AudioStart(**fmt).event())
        for chunk in chunk_pcm(decoded.pcm, decoded.width, decoded.channels):
            await self.write_event(AudioChunk(audio=chunk, **fmt).event())
        await self.write_event(AudioStop().event())
        return True

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
            kind, detail = self._failure(exc)
            logger.error("Conversation request failed (%s): %s", kind, detail)
            await self.write_event(NotHandled(text=SPOKEN[kind], context=context).event())
            return

        if not reply:
            logger.error("Conversation request failed (%s): empty reply", BAD_RESPONSE)
            await self.write_event(NotHandled(text=SPOKEN[BAD_RESPONSE], context=context).event())
            return

        conversation_id = conversation_id or uuid.uuid4().hex
        context["conversation_id"] = conversation_id
        await self.write_event(Handled(text=reply, context=context).event())
        # Recorded only once the answer has gone out: if the client is already gone the
        # write above raises and the turn never reaches the history.
        self._conversations.record(conversation_id, text, reply)
        if self._config.log_transcripts:
            logger.info("Reply: %r", reply[:120])
        else:
            logger.info("Reply sent (%d characters)", len(reply))
