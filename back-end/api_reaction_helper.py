"""Helper function for aggregating reactions"""
from typing import List, Dict, Any

def aggregate_reactions(reactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not reactions:
        return []
    
    grouped: Dict[str, List[str]] = {}
    for r in reactions:
        emoji = r.get("emoji")
        user_id = r.get("userId")
        if not emoji or not user_id:
            continue
        if emoji not in grouped:
            grouped[emoji] = []
        grouped[emoji].append(user_id)
    
    return [
        {"emoji": emoji, "count": len(user_ids), "userIds": user_ids}
        for emoji, user_ids in grouped.items()
    ]
