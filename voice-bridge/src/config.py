"""Voice Bridge configuration, read once from the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def debug_enabled(env: dict[str, str] | None = None) -> bool:
    """
    True when DEBUG asks for debug logging. Only 1, true, yes and on count, the
    same words WYOMING_ZEROCONF accepts, so DEBUG=0 and DEBUG=false stay quiet.
    """
    e = os.environ if env is None else env
    return _bool(e.get("DEBUG", ""))


@dataclass(frozen=True)
class BridgeConfig:
    """Everything the bridge needs to reach ci-server and describe itself to HA."""

    ci_server_url: str = "http://localhost:8080"
    # No default key: ci-server enforces the master key in every environment,
    # so a placeholder here would only turn a config error into a 401 loop.
    ci_server_api_key: str = ""
    model: str = "ollama:llama3.2"
    stt_model: str = "whisper-1"
    tts_model: str = "tts-1"
    tts_voice: str = "alloy"
    tts_voices: list[str] = field(default_factory=lambda: ["alloy"])
    languages: list[str] = field(default_factory=lambda: ["en"])
    system_instructions: str = (
        "You are a concise smart home voice assistant. Answer in one or two sentences."
    )
    host: str = "0.0.0.0"
    port: int = 10700
    zeroconf: bool = False
    zeroconf_name: str = "companion-voice"
    request_timeout_s: float = 60.0
    # Conversation memory kept by the bridge so follow-up questions have context.
    history_turns: int = 6
    history_ttl_s: float = 300.0
    # Hard cap on buffered STT audio (16 kHz * 2 bytes * 30 s).
    max_audio_bytes: int = 16000 * 2 * 30
    # Off by default: what people say and what they hear back stays out of the logs.
    # Turn it on (LOG_TRANSCRIPTS=true) only while troubleshooting.
    log_transcripts: bool = False
    # Off by default: Home Assistant is always told about all three services, as it always
    # was. On (HIDE_UNCONFIGURED_SPEECH=true), each Describe asks ci-server which speech
    # backends it has and leaves out speech-to-text or text-to-speech when it has none.
    hide_unconfigured_speech: bool = False

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> "BridgeConfig":
        e = os.environ if env is None else env
        tts_voice = e.get("CI_TTS_VOICE", "alloy")
        voices = _csv(e.get("CI_TTS_VOICES", "")) or [tts_voice]
        if tts_voice not in voices:
            voices.insert(0, tts_voice)
        defaults = BridgeConfig()
        return BridgeConfig(
            ci_server_url=e.get("CI_SERVER_URL", defaults.ci_server_url).rstrip("/"),
            ci_server_api_key=e.get("CI_SERVER_API_KEY", ""),
            model=e.get("CI_MODEL", defaults.model),
            stt_model=e.get("CI_STT_MODEL", defaults.stt_model),
            tts_model=e.get("CI_TTS_MODEL", defaults.tts_model),
            tts_voice=tts_voice,
            tts_voices=voices,
            languages=_csv(e.get("LANGUAGES", "en")) or ["en"],
            system_instructions=e.get("SYSTEM_INSTRUCTIONS", defaults.system_instructions).strip(),
            host=e.get("VOICE_BRIDGE_HOST", defaults.host),
            port=int(e.get("VOICE_BRIDGE_PORT", str(defaults.port))),
            zeroconf=_bool(e.get("WYOMING_ZEROCONF", "false")),
            zeroconf_name=e.get("WYOMING_ZEROCONF_NAME", defaults.zeroconf_name),
            request_timeout_s=float(e.get("CI_REQUEST_TIMEOUT_S", str(defaults.request_timeout_s))),
            history_turns=int(e.get("HISTORY_TURNS", str(defaults.history_turns))),
            history_ttl_s=float(e.get("HISTORY_TTL_S", str(defaults.history_ttl_s))),
            log_transcripts=_bool(e.get("LOG_TRANSCRIPTS", "false")),
            hide_unconfigured_speech=_bool(e.get("HIDE_UNCONFIGURED_SPEECH", "false")),
        )
