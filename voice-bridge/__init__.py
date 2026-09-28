"""
Voice Bridge: a Wyoming server that connects Home Assistant (and the Voice PE
device behind it) to the ci-server OpenAI-compatible facade.

Architecture:
  Voice PE --(ESPHome)--> Home Assistant Assist --(Wyoming TCP)--> Voice Bridge --(HTTP)--> ci-server --> Ollama / Companion Memory
"""
