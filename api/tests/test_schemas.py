from app.schemas import AnalysisPublic, DetectionPublic, VideoPublic


def required_in_responses(model: type[VideoPublic | AnalysisPublic | DetectionPublic]) -> set[str]:
    return set(model.model_json_schema(mode="serialization")["required"])


def test_every_response_field_is_required_so_typescript_gets_null_not_optional() -> None:
    """Base fields have defaults for the tables; responses must still always include them."""
    assert required_in_responses(VideoPublic) == set(VideoPublic.model_fields)
    assert required_in_responses(AnalysisPublic) == set(AnalysisPublic.model_fields)
    assert required_in_responses(DetectionPublic) == set(DetectionPublic.model_fields)
