"""Run with python scripts/test_tuixue_pack.py; no source archive needed."""
from collections import Counter
import json
from pathlib import Path
import unittest


class PackContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "knowledge/mentors/tuixue.json"
        cls.pack = json.loads(path.read_text(encoding="utf-8"))

    def test_evidence_and_unique_case_ids(self):
        cases = self.pack["cases"]
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(Counter(case["reveal"]["action"] for case in cases),
                         {"open": 35, "no_open": 18, "unknown": 2})
        for case in cases:
            reveal = case["reveal"]
            self.assertLess(case["date"], case["nextDate"])
            self.assertTrue(reveal["sources"])
            if reveal["action"] != "unknown":
                self.assertTrue(reveal["sourcePosts"])
                self.assertTrue(all(post["url"].startswith("https://www.tgb.cn/a/")
                                    for post in reveal["sourcePosts"]))
            if reveal["action"] == "no_open":
                self.assertTrue(any("连续交割单页" in s for s in reveal["sources"]))
            if reveal["action"] == "open":
                self.assertTrue(any("证券买入" in s for s in reveal["sources"]))

    def test_question_contains_only_prior_close_fields(self):
        for case in self.pack["cases"]:
            self.assertEqual(set(case) - {"reveal"}, {
                "id", "date", "nextDate", "prompt", "scene", "market", "holdingCount", "positionPct"})
            self.assertEqual(set(case["market"]), {"pct", "d5", "d20"})
            self.assertLessEqual(0, case["positionPct"])
            self.assertLessEqual(case["positionPct"], 100)

    def test_point_in_time_scene(self):
        for case in self.pack["cases"]:
            scene = case["scene"]
            self.assertEqual(scene["asOf"], case["date"] + "T15:00:00+08:00")
            metrics = {metric["key"]: metric for metric in scene["metrics"]}
            self.assertGreaterEqual(metrics["n"]["value"], metrics["up"]["value"] + metrics["dn"]["value"])
            self.assertTrue(all(case["date"] in metric["source"] for metric in metrics.values()))
            self.assertTrue(all(metric["definition"] for metric in metrics.values()))
            self.assertGreaterEqual(metrics["zt"]["value"], sum(metrics[f"ladder{i}"]["value"] for i in range(1,5)))
            for k in (2, 3, 4):
                metric = metrics[f"ladder{k}"]
                self.assertEqual(len(metric["members"]), min(metric["value"], 4))
                for code in metric["members"]:
                    self.assertRegex(code, r"^\d{6}$")
                    self.assertIn(code, metric["definition"])
            self.assertTrue(scene["missing"])

    def test_methods_have_direct_evidence_and_counterexamples(self):
        ids = {c["id"] for c in self.pack["cases"]}
        dates = {q["date"] for q in self.pack["quotes"]}
        for method in self.pack["methods"]:
            self.assertIn(method["quoteDate"], dates)
            self.assertTrue(method["pairedEvidence"]["source"].startswith("dump/imgs_deal/"))
            self.assertIn(method["support"]["caseId"], ids)
            self.assertIn(method["counter"]["caseId"], ids)
            self.assertNotEqual(method["support"]["caseId"], method["counter"]["caseId"])
            n = method["testResult"]
            self.assertEqual(n["known"], n["support"] + n["counter"])
            self.assertGreater(min(n["support"], n["counter"]), 0)

    def test_timeline_sources(self):
        quotes = self.pack["quotes"]
        self.assertEqual(quotes, sorted(quotes, key=lambda quote: quote["date"]))
        for quote in quotes:
            self.assertTrue(quote["url"].startswith("https://www.tgb.cn/a/"))
            self.assertIn("楼", quote["source"])
            self.assertNotIn("[quote]", quote["text"])


if __name__ == "__main__":
    unittest.main()



