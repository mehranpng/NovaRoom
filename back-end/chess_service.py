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
    "2+1": _tc(2, 1),
    "3+0": _tc(3, 0),
    "3+2": _tc(3, 2),
    "5+0": _tc(5, 0),
    "5+5": _tc(5, 5),
    "10+0": _tc(10, 0),
    "15+10": _tc(15, 10),
    "30+0": _tc(30, 0),
}

UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
FIRST_MOVE_BULLET_MS = 15 * 1000
FIRST_MOVE_BLITZ_MS = 20 * 1000
FIRST_MOVE_RAPID_MS = 60 * 1000
FIRST_MOVE_WINDOW_MS = FIRST_MOVE_RAPID_MS
LONG_MOVE_MAX_PLY = 20
DISCONNECT_MIN_MS = 30 * 1000
DISCONNECT_MAX_MS = 180 * 1000
DISCONNECT_GRACE_MS = 60 * 1000
DOUBLE_DISCONNECT_MS = 60 * 1000
WAITING_TTL_MS = 10 * 60 * 1000
UNRATED_REASONS = {"aborted", "first_move_timeout", "double_disconnect_draw"}
ABORTED_REASONS = {"aborted", "first_move_timeout"}
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
        "invitedGroupId": None,
        "players": players,
        "timeControl": time_control,
        "baseMs": tc["baseMs"],
        "incMs": tc["incMs"],
        "status": "waiting",
        "moves": [],
        "clocks": {"white": tc["baseMs"], "black": tc["baseMs"]} if tc["baseMs"] else None,
        "lastMoveAt": now,
        "disconnectedAt": {"white": None, "black": None},
        "disconnectUsedMs": {"white": 0, "black": 0},
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


def first_move_window_ms(game):
    base_ms = game.get("baseMs") or 0
    if 0 < base_ms < 180_000:
        return FIRST_MOVE_BULLET_MS
    if 180_000 <= base_ms < 600_000:
        return FIRST_MOVE_BLITZ_MS
    return FIRST_MOVE_RAPID_MS


def long_move_limit_ms(game):
    if not is_timed(game):
        return None
    return int(game["baseMs"] * 0.5)


def disconnect_timeout_ms(game):
    base_s = (game.get("baseMs") or 0) / 1000.0
    inc_s = (game.get("incMs") or 0) / 1000.0
    raw_ms = int(round((base_s + 40.0 * inc_s) * 0.10 * 1000))
    return max(DISCONNECT_MIN_MS, min(DISCONNECT_MAX_MS, raw_ms))


def _active_color(game, user_id):
    if game["status"] != "active":
        raise ChessError("not_active")
    color = color_of(game, user_id)
    if color is None:
        raise ChessError("forbidden")
    return color


def _finish(game, result, reason, now):
    if is_timed(game) and len(game["moves"]) >= 2 and reason != "timeout":
        turn = turn_by_ply(game)
        elapsed = max(0, now - game["lastMoveAt"])
        game["clocks"][turn] = max(0, game["clocks"][turn] - elapsed)
    if reason in UNRATED_REASONS or result == "*":
        game["rated"] = False
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


def set_connected(game, user_id, connected, now):
    color = color_of(game, user_id)
    if color is None or game.get("status") != "active":
        return None
    disc = game.setdefault("disconnectedAt", {"white": None, "black": None})
    used = game.setdefault("disconnectUsedMs", {"white": 0, "black": 0})
    if connected:
        if disc.get(color) is not None:
            if turn_by_ply(game) == color:
                used[color] = used.get(color, 0) + max(0, now - max(disc[color], game["lastMoveAt"]))
            disc[color] = None
    elif disc.get(color) is None:
        disc[color] = now
    return {"kind": "presence"}


def set_invitee(game, user_id, target_id):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if user_id != game["creatorId"]:
        raise ChessError("forbidden")
    if not target_id or target_id == user_id:
        raise ChessError("bad_request")
    game["invitedChatId"] = target_id
    game["invitedGroupId"] = None


def set_group_invitee(game, user_id, group_id):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if user_id != game["creatorId"]:
        raise ChessError("forbidden")
    if not group_id:
        raise ChessError("bad_request")
    game["invitedChatId"] = None
    game["invitedGroupId"] = group_id


def _seat_opponent(game, user_id, now, rated):
    seat = "black" if game["players"]["white"] else "white"
    game["players"][seat] = user_id
    game["rated"] = rated
    game["status"] = "active"
    game["startedAt"] = now
    game["lastMoveAt"] = now
    game["disconnectedAt"] = {"white": None, "black": None}
    game["disconnectUsedMs"] = {"white": 0, "black": 0}
    return {"kind": "opponent_joined"}


def join(game, user_id, now):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if user_id == game["creatorId"] or user_id != game["invitedChatId"]:
        raise ChessError("forbidden")
    return _seat_opponent(
        game, user_id, now, not is_guest_id(game["creatorId"]) and not is_guest_id(user_id)
    )


def join_by_link(game, user_id, now, guest_token=None):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if not user_id or user_id == game["creatorId"]:
        raise ChessError("forbidden")
    if game.get("invitedChatId") and game["invitedChatId"] != user_id:
        raise ChessError("forbidden")
    if game.get("invitedGroupId") and game["invitedChatId"] != user_id:
        raise ChessError("forbidden")
    if is_guest_id(user_id):
        game["guestId"] = user_id
        game["guestToken"] = guest_token
    return _seat_opponent(
        game,
        user_id,
        now,
        False if is_guest_id(user_id) else not is_guest_id(game["creatorId"]),
    )


def join_group(game, user_id, group_id, now):
    if game["status"] != "waiting":
        raise ChessError("not_joinable")
    if not user_id or user_id == game["creatorId"]:
        raise ChessError("forbidden")
    if not game.get("invitedGroupId") or game["invitedGroupId"] != group_id:
        raise ChessError("forbidden")
    return _seat_opponent(game, user_id, now, not is_guest_id(game["creatorId"]))


def apply_move(game, user_id, uci, now):
    color = _active_color(game, user_id)
    if not isinstance(uci, str) or not UCI_RE.match(uci):
        raise ChessError("illegal_move")
    board = board_of(game)
    if turn_by_ply(game) != color:
        raise ChessError("not_your_turn")
    expired = check_deadline(game, now)
    if expired is not None:
        return expired
    ply = len(game["moves"])
    timed = is_timed(game)
    remaining = game["clocks"][color] if timed else 0
    if timed and ply >= 2:
        remaining -= max(0, now - game["lastMoveAt"])
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
    game.setdefault("disconnectedAt", {"white": None, "black": None})[color] = None
    game.setdefault("disconnectUsedMs", {"white": 0, "black": 0})[color] = 0
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
    return _finish(game, WIN[OTHER[color]], "disconnect_abandonment", now)


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


def _candidates(game):
    if game.get("status") != "active":
        return []
    ply = len(game["moves"])
    turn = turn_by_ply(game)
    last = game["lastMoveAt"]
    items = []
    if ply < 2:
        items.append((last + first_move_window_ms(game), "first_move"))
    elif is_timed(game):
        items.append((last + game["clocks"][turn], "clock"))
        if ply < LONG_MOVE_MAX_PLY:
            items.append((last + long_move_limit_ms(game) + 1, "long_move"))
    disc = game.get("disconnectedAt") or {}
    used = game.get("disconnectUsedMs") or {}
    w_disc = disc.get("white")
    b_disc = disc.get("black")
    if w_disc is not None and b_disc is not None:
        items.append((max(w_disc, b_disc) + DOUBLE_DISCONNECT_MS, "double_disconnect"))
    elif disc.get(turn) is not None:
        rem = max(0, disconnect_timeout_ms(game) - used.get(turn, 0))
        items.append((max(disc[turn], last) + rem, "disconnect"))
    return items


def deadline_ms(game):
    items = _candidates(game)
    return min((d for d, _ in items), default=None)


def check_deadline(game, now):
    items = [(d, k) for d, k in _candidates(game) if now >= d]
    if not items:
        return None
    _, kind = min(items, key=lambda x: x[0])
    turn = turn_by_ply(game)
    if kind == "first_move":
        return _finish(game, "*", "first_move_timeout", now)
    if kind == "long_move":
        return _finish(game, WIN[OTHER[turn]], "long_move_abandonment", now)
    if kind == "double_disconnect":
        return _finish(game, "1/2-1/2", "double_disconnect_draw", now)
    if kind == "disconnect":
        return _finish(game, WIN[OTHER[turn]], "disconnect_abandonment", now)
    return _flag(game, turn, board_of(game), now)


def _disconnect_view(game):
    if game.get("status") != "active":
        return None, None
    disc = game.get("disconnectedAt") or {}
    used = game.get("disconnectUsedMs") or {}
    w_disc = disc.get("white")
    b_disc = disc.get("black")
    turn = turn_by_ply(game)
    if w_disc is not None and b_disc is not None:
        return max(w_disc, b_disc) + DOUBLE_DISCONNECT_MS, "double"
    if disc.get(turn) is not None:
        rem = max(0, disconnect_timeout_ms(game) - used.get(turn, 0))
        return max(disc[turn], game["lastMoveAt"]) + rem, turn
    other = OTHER[turn]
    if disc.get(other) is not None:
        return None, other
    return None, None


def public_view(game, now, online):
    board = board_of(game)
    ply = len(game["moves"])
    last = game["moves"][-1]["uci"] if ply else None
    active = game["status"] == "active"
    first_deadline = game["lastMoveAt"] + first_move_window_ms(game) if active and ply < 2 else None
    disc_deadline, disc_target = _disconnect_view(game)
    return {
        "id": game["_id"],
        "status": game["status"],
        "creatorId": game["creatorId"],
        "invitedChatId": game["invitedChatId"],
        "invitedGroupId": game.get("invitedGroupId"),
        "players": game["players"],
        "timeControl": game["timeControl"],
        "baseMs": game["baseMs"],
        "incMs": game["incMs"],
        "moves": game["moves"],
        "fen": board.fen(),
        "turn": turn_by_ply(game),
        "clocks": game["clocks"],
        "lastMoveAt": game["lastMoveAt"],
        "firstMoveDeadline": first_deadline,
        "disconnectDeadline": disc_deadline,
        "disconnectTarget": disc_target,
        "serverNow": now,
        "ply": ply,
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
