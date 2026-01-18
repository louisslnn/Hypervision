import json
from typing import Any, Optional

import httpx

from app.core.config import get_settings


class OpenAIResponseError(Exception):
    pass


def prepare_schema(schema: dict[str, Any]) -> dict[str, Any]:
    definitions = schema.get("$defs", {})

    def resolve(node: Any, seen: set[str]) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                key = ref.split("/")[-1]
                if key in seen:
                    return {}
                target = definitions.get(key)
                if target is None:
                    return {}
                return resolve(target, seen | {key})
            resolved = {key: resolve(value, seen) for key, value in node.items() if key != "$defs"}
            properties = resolved.get("properties")
            if isinstance(properties, dict) and properties:
                resolved.setdefault("type", "object")
                resolved.setdefault("additionalProperties", False)
                resolved["required"] = sorted(properties.keys())
            return resolved
        if isinstance(node, list):
            return [resolve(item, seen) for item in node]
        return node

    return resolve(schema, set())


class OpenAIClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        # Use None for no timeout - let requests run as long as needed
        self.timeout = None
        self._client = client or httpx.Client(timeout=None)

    def create_structured_response(
        self,
        system_prompt: str,
        user_prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.2,
        schema_name: str = "StructuredOutput",
    ) -> dict[str, Any]:
        if not self.api_key:
            raise OpenAIResponseError("OPENAI_API_KEY is not configured.")
        prepared_schema = prepare_schema(schema)
        payload = {
            "model": self.model,
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": prepared_schema,
                    "strict": True,
                }
            },
        }
        if temperature is not None and not self.model.startswith("gpt-5"):
            payload["temperature"] = temperature
        try:
            response = self._client.post(
                f"{self.base_url}/v1/responses",
                json=payload,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            message = f"OpenAI request failed ({exc.response.status_code})."
            try:
                payload = exc.response.json()
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                error_message = payload.get("error", {}).get("message")
                if isinstance(error_message, str) and error_message:
                    message = error_message
            else:
                text = exc.response.text.strip()
                if text:
                    message = text.splitlines()[0]
            raise OpenAIResponseError(message) from exc
        except httpx.HTTPError as exc:
            message = "OpenAI request failed."
            detail = str(exc).strip()
            if detail:
                message = f"OpenAI request failed: {detail}"
            raise OpenAIResponseError(message) from exc
        return self._extract_json(data)

    def _extract_json(self, payload: dict[str, Any]) -> dict[str, Any]:
        if isinstance(payload.get("output_text"), str):
            return self._parse_json_text(payload["output_text"])

        output = payload.get("output") or []
        for item in output:
            for content in item.get("content", []):
                if isinstance(content, dict):
                    if "json" in content and isinstance(content["json"], dict):
                        return content["json"]
                    text = content.get("text")
                    if isinstance(text, str):
                        return self._parse_json_text(text)

        raise OpenAIResponseError("OpenAI response did not include JSON output.")

    @staticmethod
    def _parse_json_text(text: str) -> dict[str, Any]:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise OpenAIResponseError("OpenAI response text was not valid JSON.") from exc
        if not isinstance(parsed, dict):
            raise OpenAIResponseError("OpenAI response JSON was not an object.")
        return parsed


def get_openai_client() -> OpenAIClient:
    settings = get_settings()
    return OpenAIClient(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=settings.openai_model,
        timeout=settings.openai_timeout,
    )
