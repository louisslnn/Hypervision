from app.services.pgn import build_moves_from_pgn


def test_build_moves_with_increment():
    moves_line = (
        "1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:05:00]} "
        "2. Nf3 {[%clk 0:04:59]} 2... Nc6 {[%clk 0:04:59]} 1/2-1/2"
    )
    pgn = "\n".join(['[Event "Test"]', '[TimeControl "300+2"]', moves_line, ""])
    moves = build_moves_from_pgn(pgn, "300+2")

    assert len(moves) == 4
    assert moves[0].move_san == "e4"
    assert moves[0].move_uci == "e2e4"
    assert moves[0].fen_before.startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
    assert moves[0].fen_after.startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR")
    assert moves[0].clock_remaining_ms == 300000
    assert moves[0].time_spent_ms == 2000
    assert moves[2].time_spent_ms == 3000


def test_build_moves_without_increment():
    moves_line = "1. d4 {[%clk 0:05:00]} 1... d5 {[%clk 0:05:00]} " "2. c4 {[%clk 0:04:55]} 1/2-1/2"
    pgn = "\n".join(['[Event "Test"]', '[TimeControl "300+0"]', moves_line, ""])
    moves = build_moves_from_pgn(pgn, "300+0")

    assert len(moves) == 3
    assert moves[0].time_spent_ms == 0
    assert moves[2].time_spent_ms == 5000
