import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Protocol

from app.clients.deepgram_client import (
    DeepgramClient,
    DeepgramClientError,
    DeepgramClientProtocol,
    DeepgramStreamProtocol,
)
from app.clients.soap_llm_client import SoapLlmClientProtocol
from app.clients.supabase_auth_client import AuthClientError, AuthClientProtocol
from app.core.config import settings
from app.schemas.auth import WsAuthOkEvent
from app.schemas.transcription import TranscriptionErrorEvent, TranscriptionStreamConfig
from app.services.auth_service import authenticate_access_token, parse_ws_auth_frame
from app.services.soap_stream_service import (
    ConversationSessionRegistry,
    SoapTimingOptions,
    relay_soap_conversation_stream,
)

FINAL_RESULTS_TIMEOUT_SECONDS = 5


class ClientWebSocketDisconnected(Exception):
    """ブラウザ側 WebSocket が切断されたことを表す内部例外。"""


class ClientWebSocketProtocol(Protocol):
    """FastAPI 依存を隔離するためのクライアント側 WebSocket 契約。"""

    async def receive_message(self) -> bytes | str | None:
        """受信データを返す。切断時は None を返す。"""
        ...

    async def send_text(self, text: str) -> None: ...


async def _send_error_and_close(
    client_ws: ClientWebSocketProtocol,
    on_close: Callable[[int, str], Awaitable[None]] | None,
    *,
    close_code: int,
    error_code: str,
    message: str,
    reason: str,
) -> None:
    error_event = TranscriptionErrorEvent(code=error_code, message=message)
    with suppress(Exception):
        await client_ws.send_text(error_event.model_dump_json())
    if on_close is not None:
        await on_close(close_code, reason)


async def _forward_client_to_deepgram(
    client_ws: ClientWebSocketProtocol,
    deepgram_ws: DeepgramStreamProtocol,
) -> bool:
    while True:
        payload = await client_ws.receive_message()
        if payload is None:
            # 既に切断されている場合は CloseStream 送信を無視する
            with suppress(Exception):
                await deepgram_ws.send('{"type": "CloseStream"}')
            return False
        if isinstance(payload, str):
            try:
                control = json.loads(payload)
            except ValueError:
                await deepgram_ws.send(payload)
                continue
            if isinstance(control, dict):
                if control.get("type") == "Auth":
                    # 認証フレームは上流 Deepgram へ転送しない
                    continue
                if control.get("type") == "CloseStream":
                    await deepgram_ws.send(payload)
                    return True
        await deepgram_ws.send(payload)


async def _forward_deepgram_to_client(
    deepgram_ws: DeepgramStreamProtocol,
    client_ws: ClientWebSocketProtocol,
) -> None:
    while True:
        try:
            message = await deepgram_ws.recv()
        except EOFError:
            return
        except Exception as exc:
            raise DeepgramClientError("文字起こしストリームの受信に失敗しました。") from exc
        text = message.decode("utf-8", errors="ignore") if isinstance(message, bytes) else message
        await client_ws.send_text(text)


async def relay_deepgram_stream(
    client_ws: ClientWebSocketProtocol,
    config: TranscriptionStreamConfig,
    client: DeepgramClientProtocol | None = None,
    on_close: Callable[[int, str], Awaitable[None]] | None = None,
    *,
    auth_client: AuthClientProtocol | None = None,
    auth_timeout_seconds: float | None = None,
    max_session_seconds: int | None = None,
    now_fn: Callable[[], float] | None = None,
    llm_client: SoapLlmClientProtocol | None = None,
    use_default_llm: bool = True,
    conversation_registry: ConversationSessionRegistry | None = None,
    soap_timing: SoapTimingOptions | None = None,
) -> None:
    """初回 Auth フレームを検証した上でブラウザ WebSocket と Deepgram を双方向中継する。"""
    resolved_auth_timeout = (
        auth_timeout_seconds
        if auth_timeout_seconds is not None
        else settings.ws_auth_timeout_seconds
    )

    try:
        raw_auth = await asyncio.wait_for(
            client_ws.receive_message(), timeout=resolved_auth_timeout
        )
    except TimeoutError:
        await _send_error_and_close(
            client_ws,
            on_close,
            close_code=1008,
            error_code="AUTH_TIMEOUT",
            message="認証フレームの受信がタイムアウトしました。",
            reason="auth timeout",
        )
        return

    if raw_auth is None:
        return

    try:
        token = parse_ws_auth_frame(raw_auth)
        user = await authenticate_access_token(token, client=auth_client)
    except AuthClientError as exc:
        await _send_error_and_close(
            client_ws,
            on_close,
            close_code=1008,
            error_code=exc.code,
            message=str(exc),
            reason="auth error",
        )
        return

    get_now = now_fn or time.time
    if user.expires_at <= get_now():
        await _send_error_and_close(
            client_ws,
            on_close,
            close_code=1008,
            error_code="AUTH_EXPIRED",
            message="認証の有効期限が切れています。再ログインしてください。",
            reason="auth expired",
        )
        return

    resolved_client = client or DeepgramClient()
    resolved_max_session = (
        max_session_seconds
        if max_session_seconds is not None
        else settings.transcription_max_session_seconds
    )
    use_mono_mix = config.enable_soap and config.channels == 2 and settings.stt_mono_mix_enabled
    deepgram_channels = 1 if use_mono_mix else config.channels

    try:
        async with resolved_client.connect_listen_stream(
            channels=deepgram_channels,
            language=config.language,
            sample_rate=config.sample_rate,
            endpointing_ms=config.endpointing_ms,
        ) as deepgram_ws:
            now = get_now()
            session_expires_at = min(user.expires_at, int(now) + resolved_max_session)
            remaining_seconds = float(session_expires_at) - now
            if remaining_seconds <= 0:
                await _send_error_and_close(
                    client_ws,
                    on_close,
                    close_code=1008,
                    error_code="AUTH_EXPIRED",
                    message="認証の有効期限が切れています。再ログインしてください。",
                    reason="auth expired",
                )
                return

            auth_ok = WsAuthOkEvent(
                expires_at=user.expires_at,
                session_expires_at=session_expires_at,
            )
            await client_ws.send_text(auth_ok.model_dump_json())

            if config.enable_soap:
                await relay_soap_conversation_stream(
                    client_ws=client_ws,
                    deepgram_ws=deepgram_ws,
                    config=config,
                    user_id=user.user_id,
                    user_expires_at=user.expires_at,
                    remaining_seconds=remaining_seconds,
                    on_close=on_close,
                    llm_client=llm_client,
                    use_default_llm=use_default_llm,
                    registry=conversation_registry,
                    timing=soap_timing,
                    now_fn=get_now,
                    mono_mix=use_mono_mix,
                )
                return

            client_task = asyncio.create_task(_forward_client_to_deepgram(client_ws, deepgram_ws))
            deepgram_task = asyncio.create_task(_forward_deepgram_to_client(deepgram_ws, client_ws))
            deadline_task = asyncio.create_task(asyncio.sleep(remaining_seconds))

            client_disconnected = False
            try:
                done, _ = await asyncio.wait(
                    {client_task, deepgram_task, deadline_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )

                if deadline_task in done:
                    # 期限到達後は新しい PCM を受け付けず、CloseStream と最終結果待機だけを行う
                    client_task.cancel()
                    await asyncio.gather(client_task, return_exceptions=True)
                    with suppress(Exception):
                        await deepgram_ws.send('{"type": "CloseStream"}')
                    try:
                        await asyncio.wait_for(
                            asyncio.shield(deepgram_task), timeout=FINAL_RESULTS_TIMEOUT_SECONDS
                        )
                    except TimeoutError as exc:
                        raise DeepgramClientError(
                            "文字起こしの最終結果の待機がタイムアウトしました。"
                        ) from exc

                    expired_by_jwt = get_now() >= user.expires_at
                    await _send_error_and_close(
                        client_ws,
                        on_close,
                        close_code=1008 if expired_by_jwt else 1000,
                        error_code="AUTH_EXPIRED" if expired_by_jwt else "SESSION_LIMIT_REACHED",
                        message=(
                            "認証の有効期限に達したため文字起こしを終了しました。"
                            if expired_by_jwt
                            else "文字起こしセッションの上限時間に達したため終了しました。"
                        ),
                        reason="session expired",
                    )
                    return

                deadline_task.cancel()
                await asyncio.gather(deadline_task, return_exceptions=True)

                if client_task in done:
                    graceful = client_task.result()
                    client_disconnected = not graceful
                    if graceful:
                        try:
                            await asyncio.wait_for(
                                asyncio.shield(deepgram_task), timeout=FINAL_RESULTS_TIMEOUT_SECONDS
                            )
                        except TimeoutError as exc:
                            raise DeepgramClientError(
                                "文字起こしの最終結果の待機がタイムアウトしました。"
                            ) from exc
                else:
                    deepgram_task.result()

                if not client_disconnected and on_close is not None:
                    await on_close(1000, "stream complete")
            finally:
                for task in (client_task, deepgram_task, deadline_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(
                    client_task, deepgram_task, deadline_task, return_exceptions=True
                )
    except DeepgramClientError as exc:
        await _send_error_and_close(
            client_ws,
            on_close,
            close_code=1011,
            error_code="UPSTREAM_ERROR",
            message=str(exc),
            reason="deepgram error",
        )
