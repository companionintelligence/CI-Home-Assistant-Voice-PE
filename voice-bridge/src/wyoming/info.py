"""The Wyoming `info` answer: which services this bridge offers to Home Assistant."""
from __future__ import annotations

from wyoming.info import (
    AsrModel,
    AsrProgram,
    Attribution,
    HandleModel,
    HandleProgram,
    Info,
    TtsProgram,
    TtsVoice,
)

from src.config import BridgeConfig

VERSION = "2.0.0"

ATTRIBUTION = Attribution(name="Companion Intelligence", url="https://ci.computer")

STT_PROGRAM = "companion-stt"
TTS_PROGRAM = "companion-tts"
HANDLE_PROGRAM = "companion-conversation"


def build_info(config: BridgeConfig) -> Info:
    """
    Describe three Wyoming programs. Home Assistant turns each into an entity:
    asr becomes a speech-to-text engine, tts a text-to-speech engine, and
    handle a conversation agent. Together they make a full Assist pipeline.
    """
    languages = list(config.languages)
    return Info(
        asr=[
            AsrProgram(
                name=STT_PROGRAM,
                description="Companion Intelligence speech-to-text via ci-server",
                attribution=ATTRIBUTION,
                installed=True,
                version=VERSION,
                models=[
                    AsrModel(
                        name=config.stt_model,
                        description=f"ci-server transcription ({config.stt_model})",
                        attribution=ATTRIBUTION,
                        installed=True,
                        languages=languages,
                        version=VERSION,
                    )
                ],
            )
        ],
        tts=[
            TtsProgram(
                name=TTS_PROGRAM,
                description="Companion Intelligence text-to-speech via ci-server",
                attribution=ATTRIBUTION,
                installed=True,
                version=VERSION,
                voices=[
                    TtsVoice(
                        name=voice,
                        description=f"{voice} ({config.tts_model})",
                        attribution=ATTRIBUTION,
                        installed=True,
                        languages=languages,
                        version=VERSION,
                    )
                    for voice in config.tts_voices
                ],
            )
        ],
        handle=[
            HandleProgram(
                name=HANDLE_PROGRAM,
                description="Companion Intelligence conversation agent via ci-server",
                attribution=ATTRIBUTION,
                installed=True,
                version=VERSION,
                models=[
                    HandleModel(
                        name=config.model,
                        description=f"ci-server LLM ({config.model})",
                        attribution=ATTRIBUTION,
                        installed=True,
                        languages=languages,
                        version=VERSION,
                    )
                ],
            )
        ],
    )
