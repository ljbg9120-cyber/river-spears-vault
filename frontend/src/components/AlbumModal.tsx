/**
 * Create or edit an album: name, colour, and the cover art.
 *
 * The cover previews locally the moment it is chosen, then uploads — so a slow
 * connection never leaves the person staring at an empty square.
 */
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { api, type Folder } from "../lib/api";
import Cover from "./Cover";
import { Icon, Modal, Spinner, useToast } from "./ui";

export const ACCENTS = ["violet", "cyan", "rose", "amber", "emerald", "sky"];
export const ACCENT_HEX: Record<string, string> = {
  violet: "#8b5cf6",
  cyan: "#22d3ee",
  rose: "#fb7185",
  amber: "#fbbf24",
  emerald: "#34d399",
  sky: "#38bdf8",
};

export default function AlbumModal({
  open,
  onClose,
  folder,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Null creates a new album. */
  folder: Folder | null;
  onSaved: (folder: Folder, created: boolean) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [accent, setAccent] = useState("violet");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A blob: URL while the upload is in flight, so the art appears instantly.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<Folder | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setAccent(folder?.accent ?? "violet");
    setDraft(folder);
    setLocalPreview(null);
  }, [open, folder]);

  // Revoke the object URL rather than leaking it for the session.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const pickCover = async (file: File) => {
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setUploading(true);

    try {
      // A brand-new album has to exist before it can hold a cover.
      let target = draft;
      if (!target) {
        target = await api.post<Folder>("/api/folders", {
          name: name.trim() || "Untitled album",
          accent,
        });
        setDraft(target);
        setName(target.name);
      }

      const form = new FormData();
      form.append("file", file);
      const updated = await api.put<Folder>(`/api/folders/${target.id}/cover`, form);
      setDraft(updated);
      toast("Cover set");
    } catch (err) {
      setLocalPreview(null);
      toast(err instanceof Error ? err.message : "Could not set that cover", "err");
    } finally {
      setUploading(false);
    }
  };

  const removeCover = async () => {
    if (!draft?.has_cover) {
      setLocalPreview(null);
      return;
    }
    try {
      setDraft(await api.del<Folder>(`/api/folders/${draft.id}/cover`));
      setLocalPreview(null);
      toast("Cover removed");
    } catch {
      toast("Could not remove that cover", "err");
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), accent };
      const saved = draft
        ? await api.patch<Folder>(`/api/folders/${draft.id}`, body)
        : await api.post<Folder>("/api/folders", body);
      onSaved(saved, !folder);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "err");
    } finally {
      setBusy(false);
    }
  };

  const coverUrl = localPreview ?? (draft?.cover_url || undefined);
  const hasCover = !!coverUrl;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={folder ? "Edit album" : "New album"}
      width={480}
    >
      <div className="space-y-5">
        <div className="flex gap-4">
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => fileRef.current?.click()}
              className="group relative block"
              aria-label="Choose album cover"
            >
              <Cover url={coverUrl} size={124} radius={18} icon={30} />
              <span
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[18px] text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100"
                style={{ background: "rgba(0,0,0,0.55)" }}
              >
                {uploading ? (
                  <Spinner size={20} />
                ) : (
                  <>
                    <Icon name="upload" size={18} />
                    {hasCover ? "Replace" : "Add cover"}
                  </>
                )}
              </span>
            </motion.button>

            {hasCover && !uploading && (
              <button
                onClick={removeCover}
                className="absolute -right-2 -top-2 rounded-full p-1.5 text-white shadow-lift"
                style={{ background: "#ff5470" }}
                aria-label="Remove cover"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
                Album name
              </span>
              <input
                className="field"
                placeholder="Beat pack 01, Demos for Jae…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                autoFocus
              />
            </label>
            <p className="text-xs text-muted">
              Square works best. Anything you upload is cropped to a square and
              resized, so a photo straight off a phone is fine.
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickCover(file);
            e.target.value = "";
          }}
        />

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Colour
          </p>
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a}
                onClick={() => setAccent(a)}
                className="h-8 w-8 rounded-full transition hover:scale-110"
                style={{
                  background: ACCENT_HEX[a],
                  outline: accent === a ? "2px solid rgb(var(--ink-rgb))" : "none",
                  outlineOffset: 2,
                }}
                aria-label={a}
              />
            ))}
          </div>
        </div>

        <button onClick={save} disabled={busy || !name.trim()} className="btn-primary w-full disabled:opacity-50">
          {busy ? <Spinner size={16} /> : folder ? "Save album" : "Create album"}
        </button>
      </div>
    </Modal>
  );
}
