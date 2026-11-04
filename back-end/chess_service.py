import random
import re
import uuid
import chess


class ChessError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _tc(minutes, increment_seconds):
    return {"baseMs": minutes * 60000, "incMs": increment_seconds * 1000}


TIME_CONTROLS = {
    "unlimited": {"baseMs": 0, "incMs": 0},
    "1+0": _tc(1, 0),
    "3+0": _tc(3, 0),
    "3+2": _tc(3, 2),
    "5+0": _tc(5, 0),
    "10+0": _tc(10, 0),
    "15+10": _tc(15, 10),
    "30+0": _tc(30, 0),
}

UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
FIRST_MOVE_WINDOW_MS = 60000
DISCONNECT_GRACE_MS = 60000
WAITING_TTL_MS = 10 * 60 * 1000
OTHER = {"white": "black", "black": "white"}
WIN = {"white": "1-0", "black": "0-1"}
REASONS = {
    "CHECKMATE": "checkmate",
    "STALEMATE": "stalemate",
    "INSUFFICIENT_MATERIAL": "insufficient",
    "THREEFOLD_REPETITION": "repetition",
    "FIVEFOLD_REPETITION": "repetition",
    "FIFTY_MOVES": "fifty",
    "SEVENTYFIVE_MOVES": "fifty",
}


def is_guest_id(user_id):
    return isinstance(user_id, str) and user_id.startswith("guest_")


def _k_factor(elo, games_played):
    if games_played < 10:
        return 40
    if elo < 2100:
        return 32
    return 16


def compute_elo_changes(white_elo, white_games, black_elo, black_games, result):
    if result == "1-0":
        sw, sb = 1.0, 0.0
    elif result == "0-1":
        sw, sb = 0.0, 1.0
    elif result == "1/2-1/2":
        sw, sb = 0.5, 0.5
    else:
        return None
    ew = 1.0 / (1.0 + 10.0 ** ((black_elo - white_elo) / 400.0))
    eb = 1.0 - ew
    kw = _k_factor(white_elo, white_games)
    kb = _k_factor(black_elo, black_games)
    dw = int(round(kw * (sw - ew)))
    db = int(round(kb * (sb - eb)))
    next_w = max(100, white_elo + dw)
    next_b = max(100, black_elo + db)
    return {
        "white": {"before": white_elo, "after": next_w, "delta": next_w - white_elo},
        "black": {"before": black_elo, "after": next_b, "delta": next_b - black_elo},
    }


def new_game(creator_id, color, time_control, now):
    if time_control not in TIME_CONTROLS:
        raise ChessError("invalid_time_control")
    if color not in ("white", "black", "random"):
        raise ChessError("invalid_color")
    if color == "random":
        color = random.choice(("white", "black"))
    tc = TIME_CONTROLS[time_control]
    players = {"white": None, "black": None}
    players[color] = creator_id
    return {
        "_id": None,
        "creatorId": creator_id,
        "invitedChatId": None,
        "players": players,
        "timeControl": time_control,
        "baseMs": tc["baseMs"],
        "incMs": tc["incMs"],
        "status": "waiting",
        "moves": [],
        "clocks": {"white": tc["baseMs"], "black": tc["baseMs"]} if tc["baseMs"] else None,
        "lastMoveAt": now,
        "drawOfferedBy": None,
        "result": None,
        "reason": None,
        "createdAt": now,
        "startedAt": None,
        "endedAt": None,
        "finishedAt": None,
        "inviteToken": uuid.uuid4().hex[:16],
        "guestId": None,
        "guestToken": None,
        "rated": False,
        "eloProcessed": False,
        "ratingChanges": None,
    }


def board_of(game):
    board = chess.Board()
    for move in game["moves"]:
        board.push_uci(move["uci"])
    return board


def color_of(game, user_id):
    if game["players"]["white"] == user_id:
        return "white"
    if game["players"]["black"] == user_id:
        return "black"
    return None


def turn_by_ply(game):
    return "white" if len(game["moves"]) % 2 == 0 else "black"


def is_timed(game):
    return game["clocks"] is not None


def _active_color(game, user_id):
    if game["status"] != "active":
        raise ChessError("not_active")
    color = color_of(game, user_id)
    if color is None:
        raise ChessError("forbidden")
    return color


def _finish(game, result, reason, now):
    game["status"] = "finished"
    game["result"] = result
    game["reason"] = reason
    game["endedAt"] = now
    game["finishedAt"] = now
    game["drawOfferedBy"] = None
    return {"kind": "game_over", "result": result, "reason": reason}


def _flag(game, color, board, now):
    game["clocks"][color] = 0
    opponent = OTHER[color]
    opponent_color = chess.WHITE if opponent == "white" else chess.BLACK
    drawn = board.has_insufficient_material(opponent_color)
    return _finish(game, "1/2-1/2" if drawn else WIN[opponent], "timeout", now)


def set_invitee(game, user_id, target_id):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if user_id != game["creatorId"]:
        raise ChessError("forbidden")
    if not target_id or target_id == user_id:
        raise ChessError("bad_request")
    game["invitedChatId"] = target_id


def join(game, user_id, now):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if user_id == game["creatorId"] or user_id != game["invitedChatId"]:
        raise ChessError("forbidden")
    seat = "black" if game["players"]["white"] else "white"
    game["players"][seat] = user_id
    game["rated"] = not is_guest_id(game["creatorId"]) and not is_guest_id(user_id)
    game["status"] = "active"
    game["startedAt"] = now
    game["lastMoveAt"] = now
    return {"kind": "opponent_joined"}


def join_by_link(game, user_id, now, guest_token=None):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if not user_id or user_id == game["creatorId"]:
        raise ChessError("forbidden")
    if game.get("invitedChatId") and game["invitedChatId"] != user_id:
        raise ChessError("forbidden")
    seat = "black" if game["players"]["white"] else "white"
    game["players"][seat] = user_id
    if is_guest_id(user_id):
        game["guestId"] = user_id
        game["guestToken"] = guest_token
        game["rated"] = False
    else:
        game["rated"] = not is_guest_id(game["creatorId"])
    game["status"] = "active"
    game["startedAt"] = now
    game["lastMoveAt"] = now
    return {"kind": "opponent_joined"}


def apply_move(game, user_id, uci, now):
    color = _active_color(game, user_id)
    if not isinstance(uci, str) or not UCI_RE.match(uci):
        raise ChessError("illegal_move")
    board = board_of(game)
    if turn_by_ply(game) != color:
        raise ChessError("not_your_turn")
    ply = len(game["moves"])
    timed = is_timed(game)
    remaining = game["clocks"][color] if timed else 0
    if timed and ply >= 2:
        remaining -= now - game["lastMoveAt"]
        if remaining <= 0:
            return _flag(game, color, board, now)
    move = chess.Move.from_uci(uci)
    if move not in board.legal_moves:
        raise ChessError("illegal_move")
    san = board.san(move)
    event = {
        "kind": "move",
        "by": color,
        "uci": uci,
        "san": san,
        "capture": board.is_capture(move),
        "castle": board.is_castling(move),
        "promotion": move.promotion is not None,
    }
    board.push(move)
    event["check"] = board.is_check()
    game["moves"].append({"uci": uci, "san": san})
    if timed:
        game["clocks"][color] = remaining + (game["incMs"] if ply >= 2 else 0)
    game["lastMoveAt"] = now
    game["drawOfferedBy"] = None
    outcome = board.outcome(claim_draw=True)
    if outcome:
        _finish(game, outcome.result(), REASONS.get(outcome.termination.name, "draw"), now)
    return event


def resign(game, user_id, now):
    color = _active_color(game, user_id)
    return _finish(game, WIN[OTHER[color]], "resign", now)


def abort(game, user_id, now):
    _active_color(game, user_id)
    if len(game["moves"]) >= 2:
        raise ChessError("cannot_abort")
    return _finish(game, "*", "aborted", now)


def abandon(game, color, now):
    if game["status"] != "active":
        raise ChessError("not_active")
    return _finish(game, WIN[OTHER[color]], "abandoned", now)


def offer_draw(game, user_id, now):
    color = _active_color(game, user_id)
    if len(game["moves"]) < 2:
        raise ChessError("too_early")
    if game["drawOfferedBy"] == OTHER[color]:
        return accept_draw(game, user_id, now)
    if game["drawOfferedBy"] == color:
        raise ChessError("already_offered")
    game["drawOfferedBy"] = color
    return {"kind": "draw_offered", "by": color}


def accept_draw(game, user_id, now):
    color = _active_color(game, user_id)
    if game["drawOfferedBy"] != OTHER[color]:
        raise ChessError("no_offer")
    return _finish(game, "1/2-1/2", "agreement", now)


def decline_draw(game, user_id, now):
    color = _active_color(game, user_id)
    if game["drawOfferedBy"] != OTHER[color]:
        raise ChessError("no_offer")
    game["drawOfferedBy"] = None
    return {"kind": "draw_declined", "by": color}


def deadline_ms(game):
    if game["status"] != "active":
        return None
    if len(game["moves"]) < 2:
        return game["lastMoveAt"] + FIRST_MOVE_WINDOW_MS
    if not is_timed(game):
        return None
    return game["lastMoveAt"] + game["clocks"][turn_by_ply(game)]


def check_deadline(game, now):
    deadline = deadline_ms(game)
    if deadline is None or now < deadline:
        return None
    if len(game["moves"]) < 2:
        return _finish(game, "*", "aborted", now)
    return _flag(game, turn_by_ply(game), board_of(game), now)


def public_view(game, now, online):
    board = board_of(game)
    last = game["moves"][-1]["uci"] if game["moves"] else None
    return {
        "id": game["_id"],
        "status": game["status"],
        "creatorId": game["creatorId"],
        "invitedChatId": game["invitedChatId"],
        "players": game["players"],
        "timeControl": game["timeControl"],
        "baseMs": game["baseMs"],
        "incMs": game["incMs"],
        "moves": game["moves"],
        "fen": board.fen(),
        "turn": turn_by_ply(game),
        "clocks": game["clocks"],
        "lastMoveAt": game["lastMoveAt"],
        "serverNow": now,
        "ply": len(game["moves"]),
        "lastMove": {"from": last[:2], "to": last[2:4]} if last else None,
        "result": game["result"],
        "reason": game["reason"],
        "drawOfferedBy": game["drawOfferedBy"],
        "inCheck": board.is_check(),
        "online": online,
        "createdAt": game["createdAt"],
        "finishedAt": game.get("finishedAt"),
        "inviteToken": game.get("inviteToken"),
        "rated": bool(game.get("rated")),
        "ratingChanges": game.get("ratingChanges"),
    }
