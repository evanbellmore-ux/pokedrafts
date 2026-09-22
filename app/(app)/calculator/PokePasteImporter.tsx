"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/app/components/ui";
import Dialog from "@/app/components/ui/Dialog";
import { controlClassName } from "@/app/components/ui/Input";
import { abilitiesById, itemsById, movesById, speciesById } from "@/app/lib/battle/catalog";
import { STATS } from "@/app/lib/battle/model";
import { parseTeamImport, type ImportFormat, type ImportedMember } from "@/app/lib/battle/team-import";
import { fetchPokePaste } from "./pokepaste-data";
import type { AppliedPaste, PasteImport, RosterRole, TeamSourceOwner } from "./roster-prep";

type Preview = PasteImport & { version: number; focusFrom: Element | null };

type Props = {
  role: RosterRole;
  owner: TeamSourceOwner;
  applied: AppliedPaste | null;
  onApply: (owner: TeamSourceOwner, input: PasteImport) => void;
  onRemove: (owner: TeamSourceOwner) => void;
  onReveal?: (element: HTMLElement) => void;
};

function MemberPreview({ member }: { member: ImportedMember }) {
  const build = member.build;
  const species = member.speciesId ? speciesById.get(member.speciesId) : null;
  const problems = member.diagnostics.filter((entry) => entry.severity !== "info");
  const assumptions = member.diagnostics.filter((entry) => entry.severity === "info");
  return (
    <li className="min-w-0 space-y-3 rounded-lg border border-line bg-bg p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="wrap-anywhere font-semibold text-text">{member.index + 1}. {member.name}</h4>
        <span className={`text-xs font-semibold ${member.selectable ? "text-muted" : "text-danger"}`}>{member.selectable ? problems.length ? "Review limitations" : "Ready" : "Unavailable · edit text"}</span>
      </div>
      {build && (
        <>
          <p className="wrap-anywhere text-sm text-muted">{species?.name} · {build.nature} · {abilitiesById.get(build.abilityId)?.name ?? build.abilityId} · {itemsById.get(build.itemId)?.name ?? "No held item"}</p>
          <dl className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
            {STATS.map((stat) => <div key={stat}><dt className="font-semibold uppercase text-muted">{stat}</dt><dd className="tabular-nums text-text">{build.points[stat]} SP · {member.stats?.[stat] ?? "—"} stat</dd></div>)}
          </dl>
          <p className="wrap-anywhere text-sm text-text">{member.moves.map((slot) => slot.moveId ? movesById.get(slot.moveId)?.name ?? slot.moveId : "Empty slot").join(" · ")}</p>
        </>
      )}
      {!!problems.length && <ul className="list-disc space-y-1 pl-5 text-sm">{problems.map((entry, index) => <li key={index} className={`wrap-anywhere ${entry.severity === "error" ? "text-danger" : "text-muted"}`}>Line {entry.line}: {entry.message}</li>)}</ul>}
      {!!assumptions.length && <details className="text-xs text-muted"><summary className="min-h-11 cursor-pointer rounded py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Defaults and assumptions</summary><ul className="list-disc space-y-1 pl-5">{assumptions.map((entry, index) => <li key={index} className="wrap-anywhere">{entry.message}</li>)}</ul></details>}
    </li>
  );
}

export default function PokePasteImporter({ role, owner, applied, onApply, onRemove, onReveal }: Props) {
  const id = useId();
  const [url, setUrl] = useState(applied?.url ?? "");
  const [text, setText] = useState(applied?.text ?? "");
  const [title, setTitle] = useState(applied?.title ?? "");
  const [format, setFormat] = useState<ImportFormat>(applied?.team.format ?? "champions");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const version = useRef(0);
  const request = useRef<AbortController | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const ownership = role === "own" ? "My team" : "Opponent";

  useEffect(() => () => { version.current++; request.current?.abort(); }, []);
  useEffect(() => {
    const heading = previewHeading.current;
    const from = preview?.focusFrom;
    if (heading && from && (document.activeElement === from || (!from.isConnected && document.activeElement === document.body))) {
      if (onReveal) onReveal(heading); else heading.focus();
    }
  }, [preview, onReveal]);

  function returnFocus(element: HTMLElement | null) {
    if (element) { if (onReveal) onReveal(element); else element.focus(); }
  }

  function invalidate() {
    version.current++;
    request.current?.abort();
    request.current = null;
    setPending(false);
    setPreview(null);
    setError("");
  }

  function previewText() {
    invalidate();
    const team = parseTeamImport(text, format);
    setPreview({ team, text, title: title.trim() || team.title || "Imported team", url: null, version: version.current, focusFrom: document.activeElement });
  }

  async function loadLink() {
    invalidate();
    const controller = new AbortController();
    request.current = controller;
    const started = version.current;
    const focusOrigin = document.activeElement;
    setPending(true);
    try {
      const result = await fetchPokePaste(url.trim(), controller.signal);
      if (request.current !== controller || controller.signal.aborted || started !== version.current) return;
      const team = parseTeamImport(result.paste, format);
      const name = result.title.trim().slice(0, 160) || team.title?.slice(0, 160) || "Imported team";
      setText(result.paste);
      setTitle(name);
      const focused = document.activeElement;
      // A pending button may blur to body; another editor must keep its focus.
      const ownsFocus = focused === focusOrigin || focused === cancelButton.current
        || (focused === document.body && focusOrigin instanceof HTMLButtonElement && focusOrigin.disabled);
      setPreview({ team, text: result.paste, title: name, url: result.url, version: started, focusFrom: ownsFocus ? focused : null });
    } catch (failure) {
      if (request.current !== controller || controller.signal.aborted || started !== version.current) return;
      setError(failure instanceof Error ? failure.message : "Could not read PokéPaste. Paste the team text instead.");
      if (document.activeElement === cancelButton.current) returnFocus(urlInput.current);
    } finally {
      if (request.current === controller) { request.current = null; setPending(false); }
    }
  }

  const selectable = preview?.team.members.filter((member) => member.selectable).length ?? 0;
  const canApply = !!preview && selectable > 0 && !preview.team.diagnostics.some((entry) => entry.severity === "error");

  return (
    <section data-paste-importer={role} aria-labelledby={`${id}-heading`} className="min-w-0 space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-text">{ownership} · PokéPaste</h2>
      <p className="text-sm text-muted">Import a link or paste team text, review the sets, then choose a Pokémon from your team shortcuts. Session only; nothing is saved to your account or a league.</p>
      {applied && (
        <div className="space-y-2 rounded-lg border border-line bg-bg p-3">
          <p className="wrap-anywhere text-sm text-text"><strong>{applied.title}</strong> · {applied.team.members.filter((member) => member.selectable).length} selectable / {applied.team.members.length} imported</p>
          <p className="text-xs text-muted">Replacing or removing this team clears its cached set edits, but keeps the active Pokémon as manual preparation.</p>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => { invalidate(); setRemoveOpen(true); }}>Remove imported team</Button>
        </div>
      )}
      <Field id={`${id}-format`} label="Spread format" help="Champions exports also call Stat Points ‘EVs’. Choose the source format explicitly; values are never auto-detected.">
        <Select value={format} onChange={(event) => { invalidate(); setFormat(event.target.value as ImportFormat); }}>
          <option value="champions">Champions Stat Points</option>
          <option value="traditional">Traditional EVs/IVs — level-50 equivalent</option>
        </Select>
      </Field>
      <p className="text-xs text-muted">{format === "champions" ? "0–32 points per stat, 66 total. EVs, SPs and Stat Points labels use points in this mode; IV fields are not supported." : "EVs and IVs are converted to equivalent level-50 points only when representable. For example, 252/252/4 EVs becomes 32/32/1 points. Low IVs may be impossible to represent."} Explicit non-50 levels and unsupported mechanics must be corrected in the text.</p>
      <Field id={`${id}-url`} label="PokéPaste link" help="Only https://pokepast.es links are fetched. Loading a link fills the editable text below." error={error || undefined}>
        <Input ref={urlInput} value={url} placeholder="https://pokepast.es/…" autoComplete="off" spellCheck={false} onChange={(event) => { invalidate(); setUrl(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (url.trim()) void loadLink(); } }} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!url.trim()} pending={pending} pendingText="Loading PokéPaste…" onClick={() => void loadLink()}>Load link and preview</Button>
        {pending && <Button ref={cancelButton} variant="secondary" onClick={() => { invalidate(); returnFocus(urlInput.current); }}>Cancel loading</Button>}
      </div>
      {pending && <p role="status" className="text-sm text-muted">Reading PokéPaste… Your current team is unchanged.</p>}
      {error && <p role="alert" className="sr-only">{error}</p>}
      <Field id={`${id}-text`} label="Team text" help="Showdown/PokéPaste text, up to 24 Pokémon and 64 KiB. Separate sets with a blank line. Edit any reported lines here, then preview again.">
        <textarea id={`${id}-text`} aria-describedby={`${id}-text-help`} value={text} spellCheck={false} rows={10} className={`${controlClassName} min-h-40 resize-y font-mono`} placeholder={"Raichu @ Raichunite X\nAbility: Static\nEVs: 32 SpA / 32 Spe\nTimid Nature\n- Thunderbolt\n- Protect"} onChange={(event) => { invalidate(); setText(event.target.value); }} />
      </Field>
      <Field id={`${id}-title`} label="Team label" help="Optional; only used to label this imported team.">
        <Input value={title} maxLength={160} onChange={(event) => { if (request.current) invalidate(); setTitle(event.target.value); }} placeholder="Imported team" />
      </Field>
      <Button ref={previewButton} variant="secondary" disabled={!text.trim() || pending} onClick={previewText}>Preview team text</Button>
      {preview && (
        <div data-paste-preview className="space-y-4 border-t border-line pt-4">
          <h3 ref={previewHeading} tabIndex={-1} className="rounded font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Import preview</h3>
          <p role="status" className="text-sm text-muted">{selectable} selectable · {preview.team.members.length - selectable} unavailable. {preview.url ? "Loaded from PokéPaste." : "Pasted team text."} Current Pokémon will not change until you choose a team entry.</p>
          {!!preview.team.diagnostics.length && <Alert variant={preview.team.diagnostics.some((entry) => entry.severity === "error") ? "error" : "info"} title="Import notes"><ul className="list-disc space-y-1 pl-5">{preview.team.diagnostics.map((entry, index) => <li key={index} className="wrap-anywhere">{entry.message}</li>)}</ul></Alert>}
          <ol className="space-y-3">{preview.team.members.map((member) => <MemberPreview key={member.index} member={member} />)}</ol>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!canApply} onClick={() => {
              if (!preview || preview.version !== version.current || !canApply) return;
              onApply(owner, { text: preview.text, team: preview.team, url: preview.url, title: title.trim() || preview.title });
              invalidate();
            }}>{applied ? "Replace team" : "Import team"}{preview.team.members.length > selectable ? ` (${selectable} selectable)` : ""}</Button>
            <Button variant="secondary" onClick={() => { invalidate(); returnFocus(previewButton.current?.disabled ? urlInput.current : previewButton.current); }}>Cancel preview</Button>
          </div>
          {!canApply && <p className="text-sm text-danger">Correct the reported issues in the text, then preview again. At least one selectable set is required.</p>}
        </div>
      )}
      <Dialog open={removeOpen} onReturnFocus={onReveal} onClose={() => setRemoveOpen(false)} title="Remove imported team?" description="This removes the team and its cached set edits from this session. Active Pokémon stay as manual builds." confirmLabel="Remove team" danger onConfirm={() => { setRemoveOpen(false); onRemove(owner); }} />
    </section>
  );
}
