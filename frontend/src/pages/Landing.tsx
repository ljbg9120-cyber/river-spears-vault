/** The front door. */
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/ui";
import { BRAND } from "../lib/brand";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "folder",
    title: "Albums without limits",
    body: "Make as many as you need — beat packs, client batches, that folder of voice memos you keep meaning to sort. Tag anything, find it in a keystroke.",
  },
  {
    icon: "comment",
    title: "Feedback pinned to the second",
    body: "Collaborators drop notes on the exact moment they mean. No more \"around the 2 minute mark, maybe 2:10?\"",
  },
  {
    icon: "link",
    title: "Private links that expire",
    body: "Send one track or a whole album. Toggle downloads, toggle comments, set an expiry, revoke it whenever you want.",
  },
  {
    icon: "sparkles",
    title: "A room that looks like you",
    body: "Fourteen animated backgrounds, six visualizers, your own colours, motion you control — and you can switch any of it off.",
  },
  {
    icon: "music",
    title: "Real waveforms",
    body: "Every upload is analysed on arrival, so you can see the track and scrub straight to the drop.",
  },
  {
    icon: "comment",
    title: "Lyrics that follow along",
    body: "Paste the words, tap once per line as the song plays, and they scroll in time on a full-screen player — with a visualizer moving behind them.",
  },
  {
    icon: "lock",
    title: "Private until you decide",
    body: "Everything lands private. Nothing is public, listed, or shared until you say so.",
  },
];

export default function Landing() {
  return (
    <div className="relative z-10">
      <section className="mx-auto max-w-4xl px-2 pb-14 pt-10 text-center sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="chip mx-auto mb-7 w-fit"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--accent-rgb))" }}
          />
          Free forever · Unlimited uploads
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="title-xl text-[2.6rem] leading-[1.03] sm:text-7xl"
        >
          Every unfinished idea,
          <br />
          <span className="gradient-text">finally in one place.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted"
        >
          {BRAND.full} is a home for the music you haven't released yet. Upload as
          much as you want, sort it into as many albums as you want, and share private
          links that bring back feedback pinned to the exact second.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link to="/signup" className="btn-primary w-full !px-7 !py-3.5 text-base sm:w-auto">
            Start your vault — free
            <Icon name="chevron" size={17} />
          </Link>
          <Link to="/login" className="btn-ghost w-full !px-7 !py-3.5 text-base sm:w-auto">
            I already have one
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-5 text-xs text-muted"
        >
          No card. No trial. No track limit. Sign in with Google or an email.
        </motion.p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-1 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
            whileHover={{ y: -5 }}
            className="card p-6"
          >
            <span
              className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
              style={{
                background: "rgb(var(--accent-rgb) / 0.14)",
                color: "rgb(var(--accent-rgb))",
              }}
            >
              <Icon name={f.icon} size={21} />
            </span>
            <h3 className="mb-1.5 font-display text-lg font-bold">{f.title}</h3>
            <p className="text-sm leading-relaxed text-muted">{f.body}</p>
          </motion.div>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-2 pb-24 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="card px-6 py-12 sm:px-12"
        >
          <h2 className="title-xl text-3xl sm:text-4xl">
            Stop losing songs to <span className="gradient-text">Untitled_final_v3</span>
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Bring the whole folder over. It costs nothing, it always will, and there is no
            cap on what you keep here.
          </p>
          <Link to="/signup" className="btn-primary mt-8 !px-8 !py-3.5 text-base">
            Make my vault
            <Icon name="chevron" size={17} />
          </Link>
        </motion.div>
      </section>

      <footer className="border-t border-[var(--hairline)] py-8 text-center text-xs text-muted">
        {BRAND.full} — a free home for unreleased music.
      </footer>
    </div>
  );
}
