"""Offline end-to-end check of the Vault API.

Runs against a throwaway database and a generated tone, so it needs no server,
no network and no Google credentials:

    ..\\.venv\\Scripts\\python.exe backend\\scripts\\selftest.py
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Point the app at a scratch data directory before anything imports config.
SCRATCH = Path(tempfile.mkdtemp(prefix="vault-selftest-"))
os.environ["VAULT_DATA_DIR"] = str(SCRATCH)
os.environ["VAULT_SECRET_KEY"] = "selftest-secret-key-not-for-production"
os.environ["VAULT_PUBLIC_URL"] = "http://localhost:5173"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

PASSED = 0
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL {label}" + (f" -- {detail}" if detail else ""))


def make_tone(path: Path, seconds: float = 3.0) -> bool:
    """Render a short WAV with ffmpeg so upload analysis has real audio."""
    if not shutil.which("ffmpeg"):
        return False
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency=220:duration={seconds}",
            str(path),
        ],
        capture_output=True,
    )
    return proc.returncode == 0 and path.exists()


def make_image(width: int = 1400, height: int = 900) -> bytes:
    """A wide PNG with transparency, so cropping and flattening get exercised."""
    from PIL import Image

    img = Image.new('RGBA', (width, height), (180, 40, 200, 255))
    for x in range(0, width, 40):
        for y in range(0, height, 40):
            if (x // 40 + y // 40) % 2 == 0:
                img.paste((30, 210, 235, 120), (x, y, min(x + 40, width), min(y + 40, height)))
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return buf.getvalue()


def main() -> int:
    Base.metadata.create_all(bind=engine)
    client = TestClient(app)

    print("\nhealth")
    r = client.get("/api/health")
    check("health responds", r.status_code == 200, r.text)
    check("vault advertises no limits", r.json()["limits"]["tracks"] is None)
    has_ffmpeg = r.json()["ffmpeg"]

    print("\nauth")
    r = client.post(
        "/api/auth/signup",
        json={"email": "Artist@Example.com", "password": "hunter2hunter2",
              "display_name": "Test Artist"},
    )
    check("signup returns 201", r.status_code == 201, r.text)
    me = r.json()["user"]
    check("email is lowercased", me["email"] == "artist@example.com")
    check("handle is derived", me["handle"] == "testartist", me["handle"])
    check("theme has a default background", me["theme"]["background"] == "aurora")
    check("theme has a default visualizer", me["theme"]["visualizer"] == "bars")

    r = client.post(
        "/api/auth/signup",
        json={"email": "artist@example.com", "password": "otherpass123",
              "display_name": "Impostor"},
    )
    check("duplicate email is rejected", r.status_code == 409, r.text)

    r = client.post("/api/auth/login",
                    json={"email": "artist@example.com", "password": "wrongpass"})
    check("bad password is rejected", r.status_code == 401)

    r = client.post("/api/auth/login",
                    json={"email": "artist@example.com", "password": "hunter2hunter2"})
    check("login succeeds", r.status_code == 200, r.text)
    check("session cookie is set", "vault_session" in client.cookies)
    token = r.json()["token"]

    bearer = TestClient(app)
    r = bearer.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    check("bearer token works (for the phone app)", r.status_code == 200, r.text)

    r = TestClient(app).get("/api/tracks")
    check("library requires a session", r.status_code == 401)

    print("\nalbums")
    r = client.post("/api/folders", json={"name": "Beat Pack 01", "accent": "violet"})
    check("album created", r.status_code == 201, r.text)
    folder_id = r.json()["id"]

    for i in range(3):
        rr = client.post("/api/folders", json={"name": f"Album {i}", "accent": "cyan"})
        check(f"album {i} created (no cap)", rr.status_code == 201)
    r = client.get("/api/folders")
    check("all four albums listed", len(r.json()) == 4, str(len(r.json())))

    print("\nalbum covers")
    r = client.get("/api/folders")
    check("albums start with no cover", all(not f["has_cover"] for f in r.json()))

    r = client.put(
        f"/api/folders/{folder_id}/cover",
        files={"file": ("cover.png", make_image(), "image/png")},
    )
    check("cover uploaded", r.status_code == 200, r.text)
    check("album now reports a cover", r.json()["has_cover"] is True)
    check("cover url points at the album",
          f"/api/folders/{folder_id}/cover" in r.json()["cover_url"],
          r.json()["cover_url"])
    check("cover url is versioned for caching", "v=" in r.json()["cover_url"])

    r = client.get(f"/api/folders/{folder_id}/cover")
    check("cover served", r.status_code == 200, r.text[:120])
    check("cover re-encoded as jpeg", r.headers["content-type"] == "image/jpeg")
    check("cover is cacheable", "immutable" in r.headers.get("cache-control", ""))
    full_bytes = len(r.content)
    r = client.get(f"/api/folders/{folder_id}/cover", params={"thumb": True})
    check("thumbnail served", r.status_code == 200)
    check("thumbnail is smaller than the full cover", len(r.content) < full_bytes,
          f"{len(r.content)} vs {full_bytes}")

    from PIL import Image as _Image
    square = _Image.open(io.BytesIO(client.get(f"/api/folders/{folder_id}/cover").content))
    check("cover cropped square", square.width == square.height, str(square.size))
    check("cover capped at 1000px", square.width == 1000, str(square.size))

    r = client.put(
        f"/api/folders/{folder_id}/cover",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
    )
    check("non-image cover rejected", r.status_code == 415, r.text)

    r = TestClient(app).get(f"/api/folders/{folder_id}/cover")
    check("private album art hidden from strangers", r.status_code == 404)

    print("\nupload")
    tone = SCRATCH / "my demo_idea.wav"
    if not make_tone(tone):
        print("  skip upload checks -- ffmpeg not available")
    else:
        with tone.open("rb") as fh:
            r = client.post(
                "/api/tracks/upload",
                files={"files": ("my demo_idea.wav", fh, "audio/wav")},
                data={"folder_id": folder_id},
            )
        check("upload returns 200", r.status_code == 200, r.text)
        track = r.json()[0]
        track_id = track["id"]
        check("title cleaned from filename", track["title"] == "my demo idea",
              track["title"])
        check("duration detected", 2.5 < track["duration"] < 3.5, str(track["duration"]))
        check("waveform peaks computed", len(track["peaks"]) == 800,
              str(len(track["peaks"])))
        check("peaks are normalised 0..1",
              all(0.0 <= p <= 1.0 for p in track["peaks"]))
        check("lands in the album", track["folder_id"] == folder_id)
        check("private by default", track["visibility"] == "private")

        r = client.post(
            "/api/tracks/upload",
            files={"files": ("notes.txt", b"not audio", "text/plain")},
        )
        check("non-audio rejected", r.status_code == 415, r.text)

        print("\nstreaming")
        r = client.get(f"/api/tracks/{track_id}/stream")
        check("stream responds", r.status_code == 200, r.text)
        check("advertises range support", r.headers.get("accept-ranges") == "bytes")
        r = client.get(f"/api/tracks/{track_id}/stream", headers={"Range": "bytes=0-1023"})
        check("range request returns 206", r.status_code == 206, r.text)
        check("range length honoured", len(r.content) == 1024, str(len(r.content)))
        check("content-range header present", "content-range" in r.headers)

        r = TestClient(app).get(f"/api/tracks/{track_id}/stream")
        check("private audio hidden from strangers", r.status_code == 404)

        print("\norganising")
        r = client.patch(
            f"/api/tracks/{track_id}",
            json={"title": "Midnight Drive", "bpm": 142, "song_key": "F#m",
                  "tags": ["demo", "demo", "  keep  "]},
        )
        check("edit saves", r.status_code == 200, r.text)
        check("tags de-duplicated and trimmed",
              r.json()["tags"] == ["demo", "keep"], str(r.json()["tags"]))
        r = client.get("/api/tracks", params={"q": "midnight"})
        check("search by title", len(r.json()) == 1, str(len(r.json())))
        r = client.get("/api/tracks", params={"q": "nothingmatchesthis"})
        check("search misses cleanly", r.json() == [])
        r = client.get("/api/tracks", params={"tag": "keep"})
        check("filter by tag", len(r.json()) == 1)
        r = client.get("/api/tracks/tags")
        check("tag list built", set(r.json()) == {"demo", "keep"}, str(r.json()))

        r = client.post("/api/tracks/bulk",
                        json={"track_ids": [track_id], "add_tags": ["sent"]})
        check("bulk tag applied", "sent" in r.json()[0]["tags"], str(r.json()[0]["tags"]))

        print("\nfeedback")
        r = client.post(f"/api/tracks/{track_id}/comments",
                        json={"body": "that 808 is huge", "at_sec": 12.5})
        check("timestamped comment added", r.status_code == 201, r.text)
        check("comment marked as owner's", r.json()["is_owner"] is True)
        r = client.post(f"/api/tracks/{track_id}/like")
        check("like toggles on", r.json()["liked"] is True and r.json()["like_count"] == 1)
        r = client.post(f"/api/tracks/{track_id}/like")
        check("like toggles off", r.json()["liked"] is False)

        print("\nlyrics")
        r = client.patch(
            f"/api/tracks/{track_id}",
            json={"lyrics": "[00:01.50] first line\n\n[00:04.25] second"},
        )
        check("lyrics saved", r.status_code == 200, r.text)
        check("lyrics come back verbatim",
              r.json()["lyrics"].count("[00:") == 2, r.json()["lyrics"])
        r = client.get(f"/api/tracks/{track_id}")
        check("lyrics persist on reload", "second" in r.json()["lyrics"])
        r = client.patch(f"/api/tracks/{track_id}", json={"lyrics": ""})
        check("lyrics can be cleared", r.json()["lyrics"] == "")

        print("\nsharing")
        r = client.post("/api/shares", json={"track_id": track_id,
                                             "allow_download": True})
        check("share link created", r.status_code == 201, r.text)
        share = r.json()
        check("share url built from public_url",
              share["url"].startswith("http://localhost:5173/s/"), share["url"])
        share_token = share["token"]

        guest = TestClient(app)
        r = guest.get(f"/api/share/{share_token}")
        check("guest can open the link", r.status_code == 200, r.text)
        payload = r.json()
        check("share carries the artist's theme",
              payload["owner"]["theme"]["background"] == "aurora")
        check("share includes the track", len(payload["tracks"]) == 1)
        check("stream url carries the token",
              "?t=" in payload["tracks"][0]["stream_url"])

        r = guest.get(f"/api/tracks/{track_id}/stream", params={"t": share_token})
        check("guest can stream via token", r.status_code == 200)
        r = guest.get(f"/api/tracks/{track_id}/download", params={"t": share_token})
        check("download allowed when enabled", r.status_code == 200)
        r = guest.post(f"/api/tracks/{track_id}/comments", params={"t": share_token},
                       json={"body": "love this", "at_sec": 3.0,
                             "guest_name": "A&R Mike"})
        check("guest comment accepted", r.status_code == 201, r.text)
        check("guest name shown", r.json()["author_name"] == "A&R Mike")
        r = guest.post(f"/api/tracks/{track_id}/comments", params={"t": share_token},
                       json={"body": "anonymous"})
        check("guest must give a name", r.status_code == 422)

        r = client.post("/api/shares", json={"track_id": track_id,
                                             "folder_id": folder_id})
        check("cannot share a track and album at once", r.status_code == 422)

        r = client.delete(f"/api/shares/{share['id']}")
        check("share revoked", r.status_code == 200)
        r = guest.get(f"/api/share/{share_token}")
        check("revoked link is dead", r.status_code == 404)
        r = guest.get(f"/api/tracks/{track_id}/stream", params={"t": share_token})
        check("revoked token stops streaming", r.status_code == 404)

    print("\nlyric alignment")
    from app import align

    check("words normalised for matching",
          align.normalise("Headlights, on a ROAD!") == ["headlights", "on", "a", "road"],
          str(align.normalise("Headlights, on a ROAD!")))
    check("trailing apostrophes folded",
          align.normalise("walkin'") == ["walkin"], str(align.normalise("walkin'")))

    heard = [
        align.Word("headlights", 1.0, 1.4),
        align.Word("on", 1.4, 1.6),
        align.Word("a", 1.6, 1.7),
        align.Word("road", 1.7, 2.1),
        align.Word("every", 4.0, 4.3),
        align.Word("exit", 4.3, 4.7),
        align.Word("taking", 9.0, 9.4),
        align.Word("the", 9.4, 9.6),
        align.Word("long", 9.6, 9.9),
    ]
    lyric_lines = ["Headlights on a road", "Every exit looks the same",
                   "A line nobody sang", "Taking the long way round"]
    times, confidence = align.align(lyric_lines, heard, 14.0)
    check("first line anchored to its first word", times[0] == 1.0, str(times))
    check("second line anchored", times[1] == 4.0, str(times))
    check("unheard line left unplaced", times[2] is None, str(times))
    check("last line anchored", times[3] == 9.0, str(times))
    check("confidence reflects the misses", 0.7 < confidence < 0.8, str(confidence))

    filled = align.fill_gaps(times, 14.0)
    check("gap interpolated between neighbours", 4.0 < filled[2] < 9.0, str(filled))
    check("timings strictly ascending",
          all(x < y for x, y in zip(filled, filled[1:])), str(filled))

    nothing = align.fill_gaps([None, None, None, None], 12.0)
    check("total miss spreads lines across the track",
          nothing[0] == 0.0 and nothing[-1] == 9.0, str(nothing))

    mis = align.align(["b line", "a line"],
                      [align.Word("a", 8.0, 8.2), align.Word("b", 1.0, 1.2)], 10.0)[0]
    check("out-of-order match discarded", mis[1] is None, str(mis))

    print("\nautosync endpoint")
    r = client.get("/api/tracks/" + folder_id + "/autosync")
    check("autosync rejects a bad track id", r.status_code == 404)

    print("\nappearance")
    r = client.patch("/api/me/theme", json={"background": "starfield",
                                            "accent": "#ff4d6d", "speed": 0.9})
    check("theme saved", r.status_code == 200, r.text)
    check("background applied", r.json()["background"] == "starfield")
    check("untouched keys kept", r.json()["accent2"] == "#22d3ee")
    r = client.patch("/api/me/theme", json={"background": "not-a-real-background"})
    check("unknown background rejected", r.status_code == 422)
    r = client.patch("/api/me/theme", json={"accent": "red"})
    check("malformed colour rejected", r.status_code == 422)
    r = client.get("/api/backgrounds")
    check("background catalogue served", len(r.json()) >= 10, str(len(r.json())))

    r = client.patch("/api/me/theme", json={"visualizer": "ring", "visualizer_size": 0.4})
    check("visualizer saved", r.json()["visualizer"] == "ring", r.text)
    check("visualizer size saved", abs(r.json()["visualizer_size"] - 0.4) < 1e-6)
    r = client.patch("/api/me/theme", json={"visualizer": "off"})
    check("visualizer can be turned off", r.json()["visualizer"] == "off")
    r = client.patch("/api/me/theme", json={"visualizer": "disco-inferno"})
    check("unknown visualizer rejected", r.status_code == 422)
    r = client.patch("/api/me/theme", json={"visualizer_size": 4})
    check("out-of-range visualizer size rejected", r.status_code == 422)
    r = client.get("/api/visualizers")
    check("visualizer catalogue served", "off" in r.json(), str(r.json()))

    print("\nprofile")
    r = client.patch("/api/me", json={"handle": "Test Artist!!", "bio": "beats"})
    check("handle slugified", r.json()["handle"] == "testartist", r.json()["handle"])
    r = client.get("/api/u/testartist")
    check("public profile resolves", r.status_code == 200, r.text)
    check("private tracks stay off the profile", r.json()["tracks"] == [])

    print("\nalbum deletion keeps music")
    r = client.delete(f"/api/folders/{folder_id}")
    check("album deleted", r.status_code == 200, r.text)
    if has_ffmpeg:
        r = client.get("/api/tracks")
        check("tracks survive their album", len(r.json()) == 1, str(len(r.json())))
        check("track is now unfiled", r.json()[0]["folder_id"] is None)

    print()
    total = PASSED + len(FAILED)
    if FAILED:
        print(f"{PASSED}/{total} checks passed. Failures:")
        for name in FAILED:
            print(f"  - {name}")
        return 1
    print(f"All {total} checks passed.")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        engine.dispose()
        shutil.rmtree(SCRATCH, ignore_errors=True)
    sys.exit(code)
