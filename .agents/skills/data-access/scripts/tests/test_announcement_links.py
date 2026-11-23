import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sources.cninfo import announcement_row


def test_source_attachment_replaces_broken_detail_link():
    row = announcement_row({"announcementId": "123", "announcementTitle": "公告", "adjunctUrl": "finalpage/2026-11-13/123.PDF"}, "600825")
    assert row["url"] == "https://static.cninfo.com.cn/finalpage/2026-11-13/123.PDF"
    assert "annoId=" not in row["url"]


def test_foreign_attachment_is_not_used_and_detail_has_correct_identifiers():
    row = announcement_row({"announcementId": "123", "orgId": "gssh", "adjunctUrl": "https://evil.example/x.pdf"}, "600825")
    assert not row["pdf"]
    assert "announcementId=123" in row["url"]
    assert "stockCode=600825" in row["url"]
