"""
Voice Bridge – connects the Home Assistant Voice PE (via Wyoming WebSocket protocol)
to the ci-server OpenAI-compatible façade for STT / LLM / TTS.

Architecture:
  Voice PE ──(Wyoming WS)──► Voice Bridge ──(HTTP/WS)──► ci-server ──► Ollama

Usage:
  python main.py
  # or with environment variables:
  CI_SERVER_URL=http://localhost:8080 CI_SERVER_API_KEY=<key> python main.py
"""
