"""Workflow, privacy and migration regression tests; uses only disposable data.

Run: .venv\Scripts\python.exe backend\scripts\workflow_selftest.py
"""
from __future__ import annotations

import io
import os
import shutil
import sys
import tempfile
import unittest
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SCRATCH = Path(tempfile.mkdtemp(prefix="vault-workflow-selftest-"))
os.environ["VAULT_DATA_DIR"] = str(SCRATCH)
os.environ["VAULT_SECRET_KEY"] = "workflow-selftest-not-a-production-secret"
os.environ["VAULT_PUBLIC_URL"] = "http://localhost:5173"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import migrate  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Comment, Folder, Track, User  # noqa: E402


def audio_bytes(value: int = 0) -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(value.to_bytes(2, "little", signed=True) * 8000)
    return target.getvalue()


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(engine)

    def setUp(self):
        self.owner, self.other, self.guest = TestClient(app), TestClient(app), TestClient(app)
        self.identity = uuid.uuid4().hex[:10]
        for client, role in [(self.owner, "owner"), (self.other, "other")]:
            response = client.post("/api/auth/signup", json={
                "email": f"{role}{self.identity}@example.com", "password": "test-password-123",
                "display_name": f"{role}{self.identity}",
            })
            self.assertEqual(response.status_code, 201, response.text)
        self.folder = self.owner.post("/api/folders", json={"name": "Session"}).json()["id"]
        self.track = self.upload()[0]

    def upload(self, payload: bytes | None = None, **params):
        response = self.owner.post("/api/tracks/upload", files={
            "files": ("First mix.wav", audio_bytes() if payload is None else payload, "audio/wav"),
        }, data={"folder_id": self.folder, **params})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def revision(self, track_id=None, note="Tighter drums"):
        response = self.owner.post(f"/api/tracks/{track_id or self.track['id']}/versions", files={
            "file": ("Second mix.wav", audio_bytes(120), "audio/wav"),
        }, data={"revision_note": note})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_workflow_filters_ownership_and_bulk_are_atomic(self):
        tid = self.track["id"]
        response = self.owner.patch(f"/api/tracks/{tid}", json={
            "status": "in_review", "is_favorite": True, "tags": ["Mix review"],
        })
        self.assertEqual(response.status_code, 200, response.text)
        response = self.owner.get("/api/tracks", params={"status": "in_review", "favorite": True})
        self.assertEqual([t["id"] for t in response.json()], [tid])
        self.assertEqual(self.owner.get("/api/tracks", params={"favorite": False}).json(), [])
        self.assertEqual(self.owner.get("/api/tracks", params={"status": "bogus"}).status_code, 422)
        self.assertEqual(self.other.patch(f"/api/tracks/{tid}", json={"status": "approved"}).status_code, 404)
        second = self.upload()[0]
        # The matching tag is on the older track, beyond the unfiltered first page.
        self.assertEqual(self.owner.get("/api/tracks", params={"tag": "mix review", "limit": 1}).json()[0]["id"], tid)
        foreign_folder = self.other.post("/api/folders", json={"name": "Private"}).json()["id"]
        self.assertEqual(self.owner.post("/api/tracks/bulk", json={
            "track_ids": [tid], "folder_id": foreign_folder,
        }).status_code, 404)
        self.assertEqual(self.owner.post("/api/tracks/bulk", json={
            "track_ids": [tid, "missing"], "status": "approved",
        }).status_code, 404)
        self.assertEqual(self.owner.get(f"/api/tracks/{tid}").json()["status"], "in_review")
        response = self.owner.post("/api/tracks/bulk", json={
            "track_ids": [tid, second["id"]], "status": "approved", "is_favorite": False,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(all(t["status"] == "approved" and not t["is_favorite"] for t in response.json()))

    def test_feedback_resolution_is_owner_only_and_persists(self):
        tid = self.track["id"]
        token = self.owner.post("/api/shares", json={"track_id": tid}).json()["token"]
        comment = self.guest.post(f"/api/tracks/{tid}/comments", params={"t": token}, json={
            "body": "Bring up the vocal", "at_sec": 0.5, "guest_name": "Engineer",
        }).json()
        cid = comment["id"]
        self.assertFalse(comment["resolved"])
        self.assertEqual(self.guest.patch(f"/api/comments/{cid}", json={"resolved": True}).status_code, 401)
        self.assertEqual(self.other.patch(f"/api/comments/{cid}", json={"resolved": True}).status_code, 404)
        self.assertEqual(self.other.get("/api/feedback").json(), [])
        feedback = self.owner.get("/api/feedback", params={"resolved": False}).json()
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["track_id"], tid)
        self.assertEqual(feedback[0]["track_title"], self.track["title"])
        self.assertEqual(self.owner.get(f"/api/tracks/{tid}").json()["unresolved_comment_count"], 1)
        response = self.owner.patch(f"/api/comments/{cid}", json={"resolved": True})
        self.assertTrue(response.json()["resolved"])
        timestamp = response.json()["resolved_at"]
        self.assertIsNotNone(timestamp)
        self.assertEqual(self.owner.patch(f"/api/comments/{cid}", json={"resolved": True}).json()["resolved_at"], timestamp)
        self.assertEqual(self.owner.get("/api/feedback", params={"resolved": False}).json(), [])
        self.assertEqual(len(self.owner.get("/api/feedback", params={"resolved": True}).json()), 1)
        fresh = self.owner.get(f"/api/tracks/{tid}").json()
        self.assertEqual((fresh["comment_count"], fresh["unresolved_comment_count"]), (1, 0))
        self.assertIsNone(self.owner.patch(f"/api/comments/{cid}", json={"resolved": False}).json()["resolved_at"])
        self.assertEqual(self.owner.post(f"/api/tracks/{tid}/comments", json={"body": "   "}).status_code, 422)

    def test_saved_views_validation_crud_and_new_session(self):
        payload = {"name": "  Review queue  ", "filters": {"status": "in_review", "favorite": True}}
        response = self.owner.post("/api/library-views", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        view = response.json()
        vid = view["id"]
        self.assertEqual(view["name"], "Review queue")
        self.assertTrue(view["filters"]["latest_only"])
        # A new authenticated client retrieves database data, not client storage.
        fresh = TestClient(app)
        fresh.cookies.update(self.owner.cookies)
        self.assertEqual(fresh.get(f"/api/library-views/{vid}").json(), view)
        self.assertEqual(self.other.get("/api/library-views").json(), [])
        for method in ["get", "patch", "delete"]:
            kw = {"json": {"name": "stolen"}} if method == "patch" else {}
            self.assertEqual(getattr(self.other, method)(f"/api/library-views/{vid}", **kw).status_code, 404)
        for filters in [{"sql": "DROP TABLE tracks"}, {"q": "x" * 121}, {"status": "unknown"}]:
            self.assertEqual(self.owner.post("/api/library-views", json={"name": "invalid", "filters": filters}).status_code, 422)
        self.assertEqual(self.owner.post("/api/library-views", json={"name": " ", "filters": {}}).status_code, 422)
        self.assertEqual(self.owner.patch(f"/api/library-views/{vid}", json={"filters": None}).status_code, 422)
        response = self.owner.patch(f"/api/library-views/{vid}", json={"name": "Approved", "filters": {"status": "approved"}})
        self.assertEqual(response.json()["filters"]["status"], "approved")
        self.assertEqual(self.owner.delete(f"/api/library-views/{vid}").status_code, 200)
        self.assertEqual(self.owner.get(f"/api/library-views/{vid}").status_code, 404)

    def test_revisions_preserve_original_audio_feedback_and_sharing(self):
        tid = self.track["id"]
        self.owner.patch(f"/api/tracks/{tid}", json={
            "bpm": 120, "song_key": "Am", "tags": ["Keep"], "lyrics": "[00:00.50] Old timing",
            "visibility": "public", "status": "approved", "is_favorite": True,
        })
        original_comment = self.owner.post(f"/api/tracks/{tid}/comments", json={"body": "Original mix note"}).json()
        track_token = self.owner.post("/api/shares", json={"track_id": tid}).json()["token"]
        album_token = self.owner.post("/api/shares", json={"folder_id": self.folder}).json()["token"]
        original_audio = self.guest.get(f"/api/tracks/{tid}/stream", params={"t": track_token}).content
        revision = self.revision()
        rid = revision["id"]
        self.assertEqual((revision["version_root_id"], revision["version_number"]), (tid, 2))
        self.assertEqual((revision["title"], revision["bpm"], revision["song_key"], revision["tags"]),
                         (self.track["title"], 120, "Am", ["Keep"]))
        self.assertEqual((revision["visibility"], revision["status"], revision["is_favorite"]), ("private", "demo", False))
        self.assertEqual((revision["lyrics"], revision["comment_count"]), ("", 0))
        self.assertEqual(self.guest.get(f"/api/tracks/{tid}/stream", params={"t": track_token}).content, original_audio)
        self.assertEqual(self.owner.get(f"/api/tracks/{tid}/comments").json()[0]["id"], original_comment["id"])
        self.assertEqual(self.owner.get(f"/api/tracks/{rid}/comments").json(), [])
        for token in [track_token, album_token]:
            self.assertEqual(self.guest.get(f"/api/tracks/{rid}/stream", params={"t": token}).status_code, 404)
            self.assertEqual(self.guest.get(f"/api/share/{token}").json()["tracks"][0]["id"], tid)
            self.assertEqual(len(self.guest.get(f"/api/share/{token}").json()["tracks"]), 1)
        self.assertEqual(self.other.get(f"/api/tracks/{tid}/versions").status_code, 404)
        self.assertEqual(self.guest.get(f"/api/tracks/{tid}/versions").status_code, 401)
        self.assertEqual(self.other.post(f"/api/tracks/{tid}/versions", files={"file": ("bad.wav", audio_bytes(), "audio/wav")}).status_code, 404)
        revision_token = self.owner.post("/api/shares", json={"track_id": rid}).json()["token"]
        self.assertEqual(self.guest.get(f"/api/tracks/{rid}/stream", params={"t": revision_token}).status_code, 200)
        revision3 = self.revision(rid, "Third revision")
        self.assertEqual((revision3["version_root_id"], revision3["version_number"]), (tid, 3))
        self.assertEqual([t["version_number"] for t in self.owner.get(f"/api/tracks/{rid}/versions").json()], [1, 2, 3])
        latest = self.owner.get("/api/tracks", params={"latest_only": True}).json()
        self.assertEqual([t["id"] for t in latest], [revision3["id"]])
        self.assertEqual(self.owner.get("/api/tracks", params={"latest_only": True, "status": "approved"}).json(), [])
        self.assertEqual(len(self.owner.get("/api/tracks").json()), 3)
        self.owner.delete(f"/api/tracks/{tid}")
        self.assertEqual([t["version_number"] for t in self.owner.get(f"/api/tracks/{rid}/versions").json()], [2, 3])
        self.assertEqual(self.guest.get(f"/api/share/{album_token}").json()["tracks"], [])
        self.assertEqual(self.guest.get(f"/api/tracks/{rid}/stream", params={"t": revision_token}).status_code, 200)

    def test_concurrent_revision_uploads_get_distinct_numbers(self):
        def upload_once(value):
            client = TestClient(app)
            client.cookies.update(self.owner.cookies)
            return client.post(f"/api/tracks/{self.track['id']}/versions", files={
                "file": (f"mix-{value}.wav", audio_bytes(value), "audio/wav"),
            })
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(upload_once, [12, 34]))
        for response in results:
            self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(sorted(r.json()["version_number"] for r in results), [2, 3])

    def test_failed_uploads_leave_no_files_or_rows(self):
        before_files = set((SCRATCH / "uploads").iterdir())
        before_rows = self.owner.get("/api/tracks").json()
        response = self.owner.post("/api/tracks/upload", files=[
            ("files", ("good.wav", audio_bytes(), "audio/wav")),
            ("files", ("bad.txt", b"not audio", "text/plain")),
        ])
        self.assertEqual(response.status_code, 415)
        for blob in [b"", b"not a waveform"]:
            response = self.owner.post("/api/tracks/upload", files={"files": ("bad.wav", blob, "audio/wav")})
            self.assertEqual(response.status_code, 422, response.text)
        response = self.owner.post(f"/api/tracks/{self.track['id']}/versions", files={
            "file": ("bad.wav", b"corrupt", "audio/wav"),
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(set((SCRATCH / "uploads").iterdir()), before_files)
        self.assertEqual(self.owner.get("/api/tracks").json(), before_rows)


class MigrationTests(unittest.TestCase):
    def test_old_database_is_preserved_and_migration_is_idempotent(self):
        legacy_engine = create_engine(f"sqlite:///{(SCRATCH / 'legacy.db').as_posix()}")
        try:
            Base.metadata.create_all(legacy_engine)
            with Session(legacy_engine) as db:
                owner = User(id="legacy-owner", email="legacy@example.com", handle="legacy", display_name="Legacy")
                folder = Folder(id="legacy-folder", owner_id="legacy-owner", name="Existing album")
                track = Track(id="legacy-track", owner_id="legacy-owner", folder_id="legacy-folder", title="Keep this",
                              stored_name="original.wav", original_name="original.wav", tags=["keep"], peaks=[0.1, 0.5])
                db.add_all([owner, folder, track])
                db.flush()
                db.add(Comment(id="legacy-comment", track_id=track.id, body="Keep this feedback"))
                db.commit()
            with legacy_engine.begin() as conn:
                for table, columns in migrate.ADDITIONS.items():
                    for column in columns:
                        conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
            # This is the same startup sequence used against an existing volume.
            Base.metadata.create_all(legacy_engine)
            applied = migrate.run(legacy_engine)
            self.assertEqual(len(applied), sum(len(c) for c in migrate.ADDITIONS.values()))
            self.assertEqual(migrate.run(legacy_engine), [])
            with Session(legacy_engine) as db:
                track = db.get(Track, "legacy-track")
                self.assertEqual((track.title, track.tags, track.peaks), ("Keep this", ["keep"], [0.1, 0.5]))
                self.assertEqual((track.status, track.is_favorite, track.version_number, track.version_root_id), ("demo", False, 1, None))
                self.assertEqual(track.stored_name, "original.wav")
                comment = db.get(Comment, "legacy-comment")
                self.assertEqual(comment.body, "Keep this feedback")
                self.assertFalse(comment.resolved)
                self.assertIsNone(comment.resolved_at)
                self.assertEqual(db.get(Folder, "legacy-folder").name, "Existing album")
        finally:
            legacy_engine.dispose()


if __name__ == "__main__":
    try:
        result = unittest.main(verbosity=2, exit=False).result
    finally:
        engine.dispose()
        shutil.rmtree(SCRATCH, ignore_errors=True)
    sys.exit(not result.wasSuccessful())
