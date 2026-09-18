"""Fill a running Vault with a believable demo library.

    ..\\.venv\\Scripts\\python.exe backend\\scripts\\seed_demo.py

Generates its own audio with ffmpeg, so nothing here depends on real music.
Safe to re-run: it signs in if the demo account already exists.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8000"
EMAIL = "demo@vault.fm"
PASSWORD = "vaultdemo123"
NAME = "Nova Reyes"

# Each track gets its own ffmpeg recipe so the waveforms look different.
TRACKS = [
    ("Midnight Drive", "beats", "sine=frequency=110:duration=14", "tremolo=f=3:d=0.7", 142, "F#m",
     ["demo", "keep"], "Bassline is close. Needs a real hook on the second half."),
    ("Ghost Harmony", "beats", "sine=frequency=220:duration=12", "vibrato=f=5:d=0.6", 88, "Cm",
     ["idea"], "Layered the vocal chop three times. Might be too much."),
    ("Paper Planes", "beats", "sine=frequency=330:duration=16", "tremolo=f=1.5:d=0.9", 128, "G",
     ["needs mix"], ""),
    ("Sunroom", "voice", "sine=frequency=440:duration=11", "tremolo=f=6:d=0.5", 96, "D",
     ["demo", "sent"], "Voice memo from the car. Keep the timing, lose the noise."),
    ("Backseat", "voice", "sine=frequency=180:duration=13", "vibrato=f=3:d=0.8", 150, "Am",
     ["idea"], ""),
    ("Long Way Round", "2026", "sine=frequency=260:duration=18", "tremolo=f=2:d=0.85", 120, "Bb",
     ["keep"], "This one is basically done. Send to Jae for the mix."),
    ("Pilot Light", "2026", "sine=frequency=150:duration=15", "vibrato=f=4:d=0.7", 134, "Em",
     ["needs mix", "sent"], ""),
    ("Static Bloom", None, "sine=frequency=300:duration=10", "tremolo=f=8:d=0.6", 160, "F",
     ["idea"], "Half an idea. Revisit when the hook lands."),
]

ALBUMS = [
    ("Beat Pack 01", "violet"),
    ("Voice Memos", "cyan"),
    ("2026 Sessions", "amber"),
]
ALBUM_KEY = {"beats": "Beat Pack 01", "voice": "Voice Memos", "2026": "2026 Sessions"}

COMMENTS = [
    ("Midnight Drive", 3.2, "that switch at the top is nasty", "Jae"),
    ("Midnight Drive", 8.9, "drums could hit harder right here", "Jae"),
    ("Long Way Round", 5.4, "this is the single. don't touch it", "A&R Mike"),
    ("Sunroom", 2.1, "keep the room noise honestly, it's the vibe", "Tasha"),
]


def render(source: str, effect: str, dest: Path, shape: int = 0) -> bool:
    """Render a tone, then push it through an envelope so it has dynamics.

    A constant sine draws a flat grey brick of a waveform; swelling the volume
    on a slow cycle makes the demo look like an actual arrangement.
    """
    period = 2.5 + shape * 0.9
    envelope = f"0.15+0.85*abs(sin(2*PI*t/{period:.2f}))*(0.6+0.4*sin(2*PI*t/7))"
    chain = f"{effect},volume='{envelope}':eval=frame,volume=0.9"
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", source,
         "-af", chain, "-ar", "44100", str(dest)],
        capture_output=True,
    )
    return proc.returncode == 0 and dest.exists()


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=120, follow_redirects=True)

    try:
        client.get("/api/health").raise_for_status()
    except Exception:
        print(f"Vault API is not answering on {BASE}. Start it first.")
        return 1

    res = client.post(
        "/api/auth/signup",
        json={"email": EMAIL, "password": PASSWORD, "display_name": NAME},
    )
    if res.status_code == 409:
        print("Demo account exists; signing in.")
        res = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    res.raise_for_status()
    print(f"Signed in as {EMAIL}")

    client.patch("/api/me", json={
        "handle": "novareyes",
        "bio": "Producer + engineer. Atlanta. Most of this is unfinished on purpose.",
    })
    client.patch("/api/me/theme", json={
        "background": "aurora", "accent": "#7c5cff", "accent2": "#22d3ee",
        "intensity": 0.72, "speed": 0.55,
    })

    existing = {f["name"]: f["id"] for f in client.get("/api/folders").json()}
    folders: dict[str, str] = {}
    for name, accent in ALBUMS:
        if name in existing:
            folders[name] = existing[name]
        else:
            folder = client.post("/api/folders", json={"name": name, "accent": accent}).json()
            folders[name] = folder["id"]
            print(f"  album: {name}")

    have = {t["title"] for t in client.get("/api/tracks").json()}
    by_title: dict[str, str] = {
        t["title"]: t["id"] for t in client.get("/api/tracks").json()
    }

    with tempfile.TemporaryDirectory() as tmp:
        for shape, (title, album, source, effect, bpm, key, tags, notes) in enumerate(TRACKS):
            if title in have:
                continue
            path = Path(tmp) / f"{title}.wav"
            if not render(source, effect, path, shape):
                print(f"  ! ffmpeg could not render {title}")
                continue

            data = {}
            if album:
                data["folder_id"] = folders[ALBUM_KEY[album]]
            with path.open("rb") as fh:
                up = client.post(
                    "/api/tracks/upload",
                    files={"files": (path.name, fh, "audio/wav")},
                    data=data,
                )
            up.raise_for_status()
            track = up.json()[0]
            client.patch(f"/api/tracks/{track['id']}", json={
                "title": title, "bpm": bpm, "song_key": key,
                "tags": tags, "notes": notes,
            })
            by_title[title] = track["id"]
            print(f"  track: {title}")

    for title, at, body, who in COMMENTS:
        track_id = by_title.get(title)
        if not track_id:
            continue
        existing_bodies = {
            c["body"] for c in client.get(f"/api/tracks/{track_id}/comments").json()
        }
        if body in existing_bodies:
            continue
        client.post(f"/api/tracks/{track_id}/comments",
                    json={"body": body, "at_sec": at, "guest_name": who})

    # One public track for the profile page, plus a share link to show off.
    if "Long Way Round" in by_title:
        client.patch(f"/api/tracks/{by_title['Long Way Round']}",
                     json={"visibility": "public", "allow_download": True})

    shares = client.get("/api/shares").json()
    if not shares:
        link = client.post("/api/shares", json={
            "folder_id": folders["Beat Pack 01"],
            "label": "Beat Pack 01",
            "allow_download": False,
            "allow_comments": True,
        }).json()
        print(f"  share link: {link['url']}")
    else:
        print(f"  share link: {shares[0]['url']}")

    print(f"\nDemo ready. Sign in with {EMAIL} / {PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
