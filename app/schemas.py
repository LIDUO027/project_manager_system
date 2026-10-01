"""Pydantic 请求模型（前后端分离的契约层）。

字段全部可选，配合 service 的白名单清洗即可同时支持「新建」与「局部更新」
（PATCH 语义：只传要改的字段）。
"""
from typing import Optional

from pydantic import BaseModel, Field

from .config import REMARK_MAX_LEN, TITLE_MAX_LEN


def as_dict(model) -> dict:
    """pydantic v2 -> model_dump(exclude_unset=True)，v1 -> dict()。"""
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=True)
    return model.dict(exclude_unset=True)


class TodoIn(BaseModel):
    title: Optional[str] = Field(default=None, max_length=TITLE_MAX_LEN,
                                 description="事项，支持中英文/数字/特殊字符")
    todo_type: Optional[str] = Field(default=None, description="对外商务 / 集团内部沟通 / 研发项目")
    status: Optional[str] = Field(default=None, description="进行中 / 已完成")
    priority: Optional[str] = Field(default=None, description="P0 / P1 / P2")
    remark: Optional[str] = Field(default=None, max_length=REMARK_MAX_LEN,
                                  description="备注，最多 1000 字")
    due_date: Optional[str] = Field(default=None, description="截止日期 YYYY-MM-DD（可选）")


class StatusIn(BaseModel):
    status: str = Field(description="进行中 / 已完成")


class SettingsIn(BaseModel):
    region: Optional[str] = None


class HolidayIn(BaseModel):
    date: Optional[str] = None
    name: Optional[str] = None
    kind: Optional[str] = "holiday"
    region: Optional[str] = None


class SeedIn(BaseModel):
    reset: Optional[bool] = False
    force: Optional[bool] = False
