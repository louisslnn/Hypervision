from pydantic import BaseModel


class DataPurgeResponse(BaseModel):
    status: str
    deleted: dict[str, int]
