"""Audit the mentor index comparison on a fixed chronological holdout."""
from collections import Counter
import json
from pathlib import Path


def evaluate(cases, split):
    known = [c for c in cases if c["reveal"]["action"] != "unknown"]
    train = [c for c in known if c["nextDate"] < split]
    test = [c for c in known if c["nextDate"] >= split]
    majority = Counter(c["reveal"]["action"] for c in train).most_common(1)[0][0]
    result = dict(train=len(train), test=len(test), baseline=majority, decided=0,
                  tied=0, unmatched=0, correct=0, baselineCorrectOnDecided=0)
    for target in test:
        hits = []
        for c in train:
            distance = max(abs(c["market"][key] - target["market"][key]) / tolerance
                           for key, tolerance in [("pct", 1), ("d5", 2), ("d20", 4)])
            if distance <= 1:
                hits.append((distance, c["date"], c["reveal"]["action"]))
        votes = Counter(a for _, _, a in sorted(hits)[:3])
        if not votes:
            result["unmatched"] += 1
        elif votes["open"] == votes["no_open"]:
            result["tied"] += 1
        else:
            actual = target["reveal"]["action"]
            result["decided"] += 1
            result["correct"] += actual == votes.most_common(1)[0][0]
            result["baselineCorrectOnDecided"] += actual == majority
    return result


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / "knowledge/mentors/tuixue.json"
    pack = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps(evaluate(pack["cases"], "2017-07-01"), indent=2))
