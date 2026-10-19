"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Calculator, ChevronRight, Hammer, Swords } from "lucide-react";
import Button from "@/app/components/ui/Button";
import Field from "@/app/components/ui/Field";
import Input from "@/app/components/ui/Input";
import { TRAINING_LABEL } from "@/app/(app)/training/model/format-facts";
import { normalizeInviteCode } from "./dashboard";

/** Opens `/invite/<code>` for a pasted code or whole invite link. */
export function JoinLeagueCard() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = normalizeInviteCode(code);
    if (!clean) {
      setCodeError("Enter an invite code.");
      return;
    }
    if (!/^[A-Z0-9]+$/.test(clean)) {
      setCodeError("Invite codes only contain letters and numbers.");
      return;
    }
    setCodeError(null);
    router.push(`/invite/${encodeURIComponent(clean)}`);
  }

  return (
    <section
      aria-labelledby="join-heading"
      className="rounded-xl border border-hairline bg-panel/60 p-4 sm:p-5"
    >
      <h2 id="join-heading" className="text-sm font-semibold text-text">
        Join a league
      </h2>
      <p className="mt-1 text-sm text-muted">
        Paste the invite link or code your commissioner sent.
      </p>
      <form onSubmit={handleJoin} noValidate className="mt-4 flex items-start gap-2">
        <Field label="Invite code" hideLabel error={codeError} className="min-w-0 flex-1">
          <Input
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              if (codeError) setCodeError(null);
            }}
            placeholder="Invite code or link"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={!code.trim()}>
          Join
        </Button>
      </form>
    </section>
  );
}

const tools = [
  {
    href: "/builder",
    label: "Pool Builder",
    description: "Price Pokémon and save draft formats",
    icon: Hammer,
  },
  {
    href: "/calculator",
    label: "Damage Calculator",
    description: "Damage rolls and KO chances",
    icon: Calculator,
  },
  {
    href: "/training",
    label: TRAINING_LABEL,
    description: "Practice battles against the AI",
    icon: Swords,
  },
];

/** Shortcuts to the standalone tools, with what each one is for. */
export function ToolLinks() {
  return (
    <section
      aria-labelledby="tools-heading"
      className="rounded-xl border border-hairline bg-panel/60 p-2"
    >
      <h2 id="tools-heading" className="px-2.5 pb-1 pt-2 text-sm font-semibold text-text">
        Tools
      </h2>
      <ul>
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg/70 text-muted ring-1 ring-hairline transition-colors group-hover:text-text"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-text">{tool.label}</span>
                  <span className="block truncate text-xs text-muted">{tool.description}</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
