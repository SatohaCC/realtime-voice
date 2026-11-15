from pydantic import BaseModel


class TranscriptionStreamConfig(BaseModel):
    """リアルタイム文字起こしストリームの接続設定。"""

    channels: int = 2
    language: str = "ja"
    sample_rate: int = 16000
    endpointing_ms: int = 300


class TranscriptionErrorEvent(BaseModel):
    """WebSocket 経由でクライアントへ通知するエラーイベント。"""

    type: str = "Error"
    code: str = "TRANSCRIPTION_ERROR"
    message: str
