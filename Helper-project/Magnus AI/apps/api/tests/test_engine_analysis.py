from app.services.engine import EngineEvaluation
from app.services.engine_analysis import calculate_cpl, classify_cpl


def test_classify_cpl_thresholds():
    assert classify_cpl(0, 1) == "book"
    assert classify_cpl(10, 12) == "best"
    assert classify_cpl(40, 20) == "good"
    assert classify_cpl(90, 20) == "inaccuracy"
    assert classify_cpl(200, 20) == "mistake"
    assert classify_cpl(400, 20) == "blunder"


def test_calculate_cpl_white_and_black():
    before = EngineEvaluation(eval_cp=50, eval_mate=None, pv_uci=None, multipv=[])
    after = EngineEvaluation(eval_cp=-50, eval_mate=None, pv_uci=None, multipv=[])
    assert calculate_cpl(before, after, mover_is_white=True) == 100
    assert calculate_cpl(before, after, mover_is_white=False) == 0
