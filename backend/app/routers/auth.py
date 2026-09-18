"""Sign up, sign in (email or Google), and session handling."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..schemas import AuthOut, GoogleIn, LoginIn, SignUpIn, UserOut
from ..security import (
    COOKIE_NAME,
    create_token,
    current_user,
    hash_password,
    unique_handle,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.token_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.public_url.startswith("https://"),
        path="/",
    )


def _auth_payload(response: Response, user: User) -> AuthOut:
    token = create_token(user.id)
    _set_cookie(response, token)
    return AuthOut(user=UserOut.model_validate(user), token=token)


@router.get("/config")
def auth_config() -> dict:
    """Tells the frontend whether to render the Google button."""
    return {
        "google_enabled": settings.google_enabled,
        "google_client_id": settings.google_client_id,
    }


@router.post("/signup", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignUpIn, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "That email already has a Vault. Sign in instead.")

    user = User(
        email=email,
        display_name=body.display_name,
        handle=unique_handle(db, body.display_name or email.split("@")[0]),
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    return _auth_payload(response, user)


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not verify_password(body.password, user.password_hash):
        # Deliberately vague: do not confirm which half was wrong.
        raise HTTPException(401, "That email and password don't match.")
    return _auth_payload(response, user)


@router.post("/google", response_model=AuthOut)
def google_login(body: GoogleIn, response: Response, db: Session = Depends(get_db)):
    """Verify a Google Identity Services ID token and sign the person in."""
    if not settings.google_enabled:
        raise HTTPException(400, "Google sign-in is not configured on this server.")

    # Imported lazily so the server still boots if google-auth is missing.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        claims = google_id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        raise HTTPException(401, f"Google rejected that sign-in: {exc}") from exc

    sub = claims.get("sub")
    email = (claims.get("email") or "").lower().strip()
    if not sub or not email:
        raise HTTPException(401, "Google did not return an email for that account.")
    if not claims.get("email_verified", False):
        raise HTTPException(401, "That Google account has an unverified email.")

    user = db.query(User).filter(User.google_sub == sub).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            # Same person arriving by a second door: link the accounts.
            user.google_sub = sub
        else:
            user = User(
                email=email,
                google_sub=sub,
                display_name=claims.get("name") or email.split("@")[0],
                handle=unique_handle(db, claims.get("name") or email.split("@")[0]),
                avatar_url=claims.get("picture"),
            )
            db.add(user)
    if not user.avatar_url and claims.get("picture"):
        user.avatar_url = claims["picture"]
    db.commit()
    return _auth_payload(response, user)


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
