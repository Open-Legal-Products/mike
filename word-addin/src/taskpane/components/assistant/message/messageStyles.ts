/**
 * Visual constants duplicated from the web assistant so the standalone Word
 * bundle uses the same glass surfaces without importing Next.js application
 * code.
 */
export const RESPONSE_GLASS_SURFACE =
  "rounded-xl border border-white/70 bg-white/55 shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)] backdrop-blur-2xl";

// No backdrop-blur here: these surfaces are fully opaque (bg-white), so the
// blur is invisible while still costing a compositing layer per card in the
// Office WebView.
export const EDIT_CARD_SURFACE =
  "rounded-xl bg-white shadow-[0_3px_9px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)]";

export const EDIT_SECTION_SURFACE =
  "rounded-xl bg-white shadow-[0_3px_9px_rgba(15,23,42,0.03),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-4px_9px_rgba(255,255,255,0.05)]";
