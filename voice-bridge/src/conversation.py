"""Short-lived conversation history so follow-up questions keep their context."""
from __future__ import annotations

import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class _Conversation:
    messages: list[dict[str, str]] = field(default_factory=list)
    touched_at: float = 0.0


class ConversationStore:
    """
    In-memory, bounded store keyed by Home Assistant's conversation_id.

    Only the last `max_turns` exchanges are kept, entries expire after
    `ttl_s` seconds of silence, and at most `max_conversations` are tracked.
    """

    def __init__(
        self,
        max_turns: int = 6,
        ttl_s: float = 300.0,
        max_conversations: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_messages = max(0, max_turns) * 2
        self._ttl_s = ttl_s
        self._max_conversations = max_conversations
        self._clock = clock
        self._items: "OrderedDict[str, _Conversation]" = OrderedDict()

    def _evict(self) -> None:
        now = self._clock()
        for key in [k for k, c in self._items.items() if now - c.touched_at > self._ttl_s]:
            del self._items[key]
        while len(self._items) > self._max_conversations:
            self._items.popitem(last=False)

    def history(self, conversation_id: str | None) -> list[dict[str, str]]:
        self._evict()
        if not conversation_id or conversation_id not in self._items:
            return []
        return list(self._items[conversation_id].messages)

    def record(self, conversation_id: str | None, user_text: str, assistant_text: str) -> str:
        """Append one exchange and return the conversation id it was stored under."""
        conversation_id = conversation_id or uuid.uuid4().hex
        conv = self._items.pop(conversation_id, None) or _Conversation()
        conv.messages.extend(
            [{"role": "user", "content": user_text}, {"role": "assistant", "content": assistant_text}]
        )
        if self._max_messages:
            conv.messages = conv.messages[-self._max_messages :]
        else:
            conv.messages = []
        conv.touched_at = self._clock()
        self._items[conversation_id] = conv
        self._evict()
        return conversation_id

    def __len__(self) -> int:
        return len(self._items)
