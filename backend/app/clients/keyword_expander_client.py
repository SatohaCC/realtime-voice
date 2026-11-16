from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import re
from typing import Any, Protocol

from app.core.config import settings

_LOGGER = logging.getLogger(__name__)

_DEFAULT_EXPANDER_TIMEOUT_SECONDS = 10.0

_EXPANSION_SYSTEM_PROMPT = (
    "あなたは添付文書検索の専門アシスタントです。\n"
    "ユーザーが入力した検索語について、添付文書（電子添文）の検索精度を向上させるための"
    "「医学的同義語・類義語・正式病名・症状名」を2〜4語生成してください。\n"
    "関連しない疾患名や薬効群へ過剰に連想を広げないでください。\n"
    '結果はJSON配列形式のみで出力してください。例: ["悪心", "嘔吐"]'
)


class KeywordExpanderProtocol(Protocol):
    """添付文書キーワードの同義語・類義語拡張クライアント契約。"""

    async def expand_keywords(self, query: str) -> tuple[str, ...]: ...


def _normalize_provider_name(provider: str) -> str:
    cleaned = provider.strip().lower()
    if cleaned in {"gemini", "google-genai", "google_genai"}:
        return "google_genai"
    return provider.strip()


def _extract_response_text(result: Any) -> str:
    content = getattr(result, "content", result)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "".join(parts)
    return str(content) if content is not None else ""


def parse_expanded_keywords(output: str, original_query: str) -> tuple[str, ...]:
    """LLM のテキスト出力から元クエリと重複しない類義語配列を抽出する。"""
    original_terms = {
        term.lower() for raw in re.split(r"[\s\u3000]+", original_query) if (term := raw.strip())
    }
    match = re.search(r"\[.*?\]", output, re.DOTALL)
    if not match:
        return ()
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return ()
    if not isinstance(parsed, list):
        return ()

    terms = [
        cleaned
        for item in parsed
        if isinstance(item, str)
        and 2 <= len(cleaned := item.strip()) <= 30
        and "\n" not in cleaned
        and not any(marker in cleaned for marker in ("モック", "APIキー", "エラー", "【", "】"))
        and cleaned.lower() not in original_terms
    ]
    return tuple(list(dict.fromkeys(terms))[:4])


class LangChainKeywordExpanderClient:
    """LangChain を用いて検索語から医学的同義語・類義語を生成するクライアント。"""

    def __init__(
        self,
        *,
        provider: str | None = None,
        model: str | None = None,
        timeout_seconds: float = _DEFAULT_EXPANDER_TIMEOUT_SECONDS,
    ) -> None:
        raw_provider = provider if provider is not None else settings.soap_llm_provider
        raw_model = model if model is not None else settings.soap_llm_model
        self._provider = _normalize_provider_name(raw_provider)
        self._model_name = raw_model.strip() or "gemini-3.5-flash-lite"
        self._timeout_seconds = timeout_seconds
        self._cached_model: Any = None

    def _is_enabled(self) -> bool:
        if self._provider in {"", "off", "none"}:
            return False
        return not (
            self._provider == "google_genai"
            and not os.getenv("GOOGLE_API_KEY", "").strip()
            and not os.getenv("GEMINI_API_KEY", "").strip()
        )

    def _get_or_init_model(self) -> Any:
        if self._cached_model is not None:
            return self._cached_model

        chat_models = importlib.import_module("langchain.chat_models")
        init_chat_model = getattr(chat_models, "init_chat_model", None)
        if not callable(init_chat_model):
            raise RuntimeError("init_chat_model が見つかりません。")

        lower_name = self._model_name.lower()
        request_timeout = (
            max(10.0, self._timeout_seconds)
            if self._provider == "google_genai"
            else self._timeout_seconds
        )
        kwargs: dict[str, Any] = {
            "model_provider": self._provider,
            "max_tokens": 256,
            "timeout": request_timeout,
            "max_retries": 0,
        }
        if self._provider == "google_genai" and "gemini-3" in lower_name:
            kwargs["thinking_config"] = {"thinking_level": "minimal"}
        else:
            kwargs["temperature"] = 0

        self._cached_model = init_chat_model(self._model_name, **kwargs)
        return self._cached_model

    async def expand_keywords(self, query: str) -> tuple[str, ...]:
        """検索キーワードから添付文書検索向けの同義語・類義語を 2〜4 語生成する。"""
        stripped = query.strip()
        if len(stripped) < 2 or not self._is_enabled():
            return ()

        try:
            return await asyncio.wait_for(
                self._generate_expansion(stripped),
                timeout=self._timeout_seconds,
            )
        except TimeoutError:
            _LOGGER.warning("類義語拡張がタイムアウトしました (%.1fs)", self._timeout_seconds)
            return ()
        except Exception as exc:
            _LOGGER.warning("類義語拡張に失敗しました: %s", exc)
            return ()

    async def _generate_expansion(self, query: str) -> tuple[str, ...]:
        model = self._get_or_init_model()
        messages = [
            {"role": "system", "content": _EXPANSION_SYSTEM_PROMPT},
            {"role": "user", "content": f"検索キーワード: {query}"},
        ]
        result = await model.ainvoke(messages)
        raw_output = _extract_response_text(result).strip()
        return parse_expanded_keywords(raw_output, query)
