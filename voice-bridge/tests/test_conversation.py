"""Tests for the bounded conversation history store."""
from src.conversation import ConversationStore


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_new_conversation_gets_an_id():
    store = ConversationStore()
    cid = store.record(None, "hi", "hello")
    assert cid
    assert store.history(cid) == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_unknown_or_missing_id_has_no_history():
    store = ConversationStore()
    assert store.history(None) == []
    assert store.history("nope") == []


def test_keeps_only_last_turns():
    store = ConversationStore(max_turns=2)
    for i in range(5):
        store.record("c", f"q{i}", f"a{i}")
    assert [m["content"] for m in store.history("c")] == ["q3", "a3", "q4", "a4"]


def test_entries_expire():
    clock = FakeClock()
    store = ConversationStore(ttl_s=10, clock=clock)
    store.record("c", "q", "a")
    clock.now = 11
    assert store.history("c") == []
    assert len(store) == 0


def test_caps_conversation_count():
    store = ConversationStore(max_conversations=2)
    for cid in ("a", "b", "c"):
        store.record(cid, "q", "a")
    assert len(store) == 2
    assert store.history("a") == []


def test_history_is_a_copy():
    store = ConversationStore()
    store.record("c", "q", "a")
    store.history("c").append({"role": "user", "content": "mutated"})
    assert len(store.history("c")) == 2
