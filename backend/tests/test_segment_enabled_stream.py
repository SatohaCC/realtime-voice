import asyncio

from app.services.conversation_service import DeepgramTranscriptInput
from app.services.soap_stream_service import (
    ConversationSessionRegistry,
    stream_conversation_segment_enabled,
)
from tests.fake_soap_llm_client import FakeSoapLlmClient


def test_enabled_ack_arrives_before_slow_soap_regeneration() -> None:
    async def run() -> None:
        release = asyncio.Event()

        class SlowLlm(FakeSoapLlmClient):
            async def extract_soap(self, payload):
                await release.wait()
                return await super().extract_soap(payload)

        registry = ConversationSessionRegistry()
        record = registry.get_or_create(user_id="u", conversation_id="c")
        stream = record.transcript_state.start_stream()
        first = record.transcript_state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "頭が痛いです", True, True, 0, 1, 0.9)
        ).segment
        record.transcript_state.apply_deepgram_event(
            DeepgramTranscriptInput(1, "吐き気があります", True, True, 2, 3, 0.9)
        )
        assert first is not None
        updates = stream_conversation_segment_enabled(
            user_id="u",
            conversation_id="c",
            stream_id=stream,
            segment_id=first.segment_id,
            enabled=False,
            registry=registry,
            llm_client=SlowLlm(),
        )
        try:
            ack = await asyncio.wait_for(anext(updates), timeout=0.5)
            assert ack.segment.disabled
            assert ack.soap_status == "pending"
            assert not release.is_set()
            release.set()
            final = await asyncio.wait_for(anext(updates), timeout=1)
            assert final.segment.disabled
            assert final.soap_status == "ready"
            assert final.soap.sections.S.items
        finally:
            release.set()
            await updates.aclose()

    asyncio.run(run())


def test_patch_stream_returns_ack_and_final_as_ndjson() -> None:
    import json

    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers.dependencies import get_current_user
    from app.schemas.auth import AuthenticatedUser
    from app.services.soap_stream_service import get_default_conversation_registry

    record = get_default_conversation_registry().get_or_create(
        user_id="stream-u", conversation_id="stream-c"
    )
    stream = record.transcript_state.start_stream()
    segment = record.transcript_state.apply_deepgram_event(
        DeepgramTranscriptInput(1, "はい", True, True, 0, 1, 0.9)
    ).segment
    assert segment is not None
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        user_id="stream-u", role="authenticated", expires_at=9999999999
    )
    try:
        response = TestClient(app).patch(
            "/api/transcriptions/conversations/stream-c/segments?stream=true",
            json={
                "type": "SetSegmentEnabled",
                "stream_id": stream,
                "segment_id": segment.segment_id,
                "enabled": False,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        frames = [json.loads(line) for line in response.text.splitlines()]
        assert len(frames) == 2
        assert all(frame["segment"]["disabled"] for frame in frames)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
