import json

from app.schemas.coach import CommentaryWizardReport, GameRecapReport, MoveCommentaryReport
from app.schemas.insights import InsightsCoachReport
from app.services.openai_client import prepare_schema


def assert_no_refs(schema: dict) -> None:
    serialized = json.dumps(schema)
    assert "$ref" not in serialized


def assert_additional_properties_false(schema: object) -> None:
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict) and properties:
            assert schema.get("additionalProperties") is False
        for value in schema.values():
            assert_additional_properties_false(value)
        return
    if isinstance(schema, list):
        for item in schema:
            assert_additional_properties_false(item)


def test_prepare_schema_inlines_refs_for_move_commentary():
    schema = prepare_schema(MoveCommentaryReport.model_json_schema())
    assert schema["type"] == "object"
    assert "properties" in schema
    assert_no_refs(schema)
    assert_additional_properties_false(schema)


def test_prepare_schema_inlines_refs_for_game_recap():
    schema = prepare_schema(GameRecapReport.model_json_schema())
    assert schema["type"] == "object"
    assert "properties" in schema
    assert_no_refs(schema)
    assert_additional_properties_false(schema)


def test_prepare_schema_inlines_refs_for_commentary_wizard():
    schema = prepare_schema(CommentaryWizardReport.model_json_schema())
    assert schema["type"] == "object"
    assert "properties" in schema
    assert_no_refs(schema)
    assert_additional_properties_false(schema)


def test_prepare_schema_inlines_refs_for_insights():
    schema = prepare_schema(InsightsCoachReport.model_json_schema())
    assert schema["type"] == "object"
    assert "properties" in schema
    assert_no_refs(schema)
    assert_additional_properties_false(schema)
