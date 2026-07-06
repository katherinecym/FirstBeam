import os
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field

# 1. State Machine Definitions
class TaskState(str, Enum):
    DRAFT = "Draft"
    ACTIVE = "Active"
    FOCUSING = "Focusing"
    OVERDUE = "Overdue"
    RECOVERY = "Recovery"
    COMPLETED = "Completed"
    LET_GO = "Let Go"

# 2. Pydantic Models for Database & Communication
class Subtask(BaseModel):
    id: str = Field(description="Unique identifier for the subtask")
    task_id: str = Field(description="ID of the parent task")
    parent_subtask_id: Optional[str] = Field(None, description="Optional ID of a parent subtask for recursion")
    title: str = Field(description="Actionable and warm subtask description")
    ai_estimated_minutes: int = Field(description="Estimated duration in minutes")
    actual_minutes: Optional[int] = Field(None, description="Actual recorded completion time in minutes")
    state: TaskState = Field(default=TaskState.ACTIVE, description="State of the subtask")
    depth: int = Field(default=0, description="Nesting level of the subtask")

class Task(BaseModel):
    id: str
    title: str
    description: str
    due_at: Optional[str] = None
    state: TaskState = TaskState.DRAFT
    mbti_type: Optional[str] = None
    created_at: str
    updated_at: str

class FocusSession(BaseModel):
    id: str
    subtask_id: str
    planned_minutes: int
    actual_minutes: int
    ended_reason: str # 'completed', 'early', 'extended', 'abandoned'
    started_at: str
    ended_at: str

# 3. Agent Prompts and Intake Schemas
class IntakeAnalysis(BaseModel):
    task_type: str = Field(description="Categorized type of the task (e.g. admin, study, personal)")
    urgency: str = Field(description="Indicated level of urgency (high, medium, low)")
    ambiguity: str = Field(description="How vague the task description is (high, medium, low)")
    emotional_resistance: str = Field(description="Estimated emotional resistance (high, medium, low)")
    first_step_strategy: str = Field(description="A strategy to lower the emotional friction of starting")

class BreakdownOutput(BaseModel):
    summary_title: Optional[str] = Field(None, description="A highly concise, 2-4 word summary of the user's task to be used as the title")
    suggested_due_date_offset_days: int = Field(default=7, description="AI suggested deadline offset in days")
    subtasks: List[Subtask] = Field(description="Initial list of decomposed subtasks (max 3)")

class ShrinkOutput(BaseModel):
    subtasks: List[Subtask] = Field(description="List of recursively simplified micro-subtasks")

class PacingOutput(BaseModel):
    next_best_action_id: str = Field(description="ID of the most urgent, lowest friction step to start right now")
    estimated_total_minutes: int = Field(description="Total estimated cognitive load in minutes")
    subtasks: List[Subtask] = Field(description="The updated list of subtasks with realistic durations and ordering")

class ReflectionOutput(BaseModel):
    coaching_message: str = Field(description="A warm, encouraging reflection on the time spent vs estimated.")
    future_calibration_factor: float = Field(default=1.0, description="Multiplier for future duration estimates based on this session.")

# 4. LLM Constants
DEFAULT_MODEL = "gemini-2.5-flash"
