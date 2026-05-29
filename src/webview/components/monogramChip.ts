/**
 * monogramChip — the text-tile fallback chip (team-setup spec §3.2, §4.1, §5.3).
 *
 * Renders a small square chip showing the 2-letter initials of a display name
 * (e.g. "Felix" → "FE", "Maya" → "MA"). Used wherever a member has no assigned
 * character: the wizard preview rows, the Manage Team edit rows' leading
 * `[char]` cell, and as the picker's "clear → text tile" affordance preview.
 *
 * Identity-preserving without a sprite. Painted in the muted `available`
 * treatment (no member color, no character yet) per spec §3.2. Reuses
 * `--ct-radius-tile`; introduces NO new color/space tokens (spec §8).
 *
 * Pure DOM builder — no VS Code API, no message dispatch. Unit-testable in
 * jsdom.
 *
 * Source: team/iris-ux/team-setup-spec.md §3.2 (monogram chip), §5.3 (text tile).
 */

/**
 * Compute the 2-letter monogram for a display name. Takes the first letter of
 * the first two whitespace-separated words when there are ≥2 words; otherwise
 * the first two letters of the single word. Uppercased. Falls back to "?" when
 * the name is empty/whitespace-only (defensive — `display` is required upstream
 * but a half-edited form may pass an empty value transiently).
 */
export function monogramFor(display: string): string {
  const trimmed = (display ?? "").trim();
  if (trimmed.length === 0) {
    return "?";
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export interface MonogramChipProps {
  /** Display name the monogram is derived from. */
  display: string;
  /**
   * When true, paint at the dimmed `available` opacity (the "not set yet"
   * treatment used in the wizard preview). Defaults to false (full opacity).
   */
  muted?: boolean;
}

/**
 * Build a monogram chip element (`<span class="ct-monogram-chip">FE</span>`).
 * The 2-letter initials sit on a muted square; `aria-hidden` because the
 * adjacent display-name text already carries the identity for assistive tech.
 */
export function renderMonogramChip(props: MonogramChipProps): HTMLElement {
  const { display, muted = false } = props;
  const chip = document.createElement("span");
  chip.className = muted
    ? "ct-monogram-chip ct-monogram-chip--muted"
    : "ct-monogram-chip";
  chip.textContent = monogramFor(display);
  chip.setAttribute("aria-hidden", "true");
  return chip;
}
