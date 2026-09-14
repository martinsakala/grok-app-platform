"use client";

import { useEffect, useMemo, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import type { FieldSchema, ListedMutation } from "../mutations/index.js";
import { isPlatformClientError } from "./errors.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { MeResponse } from "./types.js";

export type MutationsPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; mutations: ListedMutation[] };

export function MutationsPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: MutationsPreview;
}) {
  const [view, setView] = useState<MutationsPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        if (!roleCovers(me.roles, "member")) {
          if (!cancelled) setView({ status: "forbidden" });
          return;
        }
        const { mutations } = await client.listMutations();
        if (!cancelled) setView({ status: "data", me, mutations });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading mutations" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Member role required.</ForbiddenState>;

  return (
    <div className="space-y-6" data-mutations-page="true">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Mutations</h1>
      <p className="text-sm text-[var(--pf-muted)]">
        Run registered writes. The same operations are available to an LLM over an API key.
      </p>
      {view.mutations.length === 0 ? (
        <EmptyState
          title="No mutations"
          body="The host has not registered any mutations you can run."
        />
      ) : (
        <ul className="space-y-4">
          {view.mutations.map((mutation) => (
            <li key={mutation.name}>
              <MutationCard client={client} mutation={mutation} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MutationCard({
  client,
  mutation,
}: {
  client: PlatformClient;
  mutation: ListedMutation;
}) {
  const fields = useMemo(() => Object.entries(mutation.input.fields), [mutation]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [errors, setErrors] = useState<{ path: string; message: string }[] | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  function setField(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function onRun() {
    setRunning(true);
    setResult(null);
    setErrors(null);
    setFail(null);
    const input: Record<string, unknown> = {};
    try {
      for (const [name, schema] of fields) {
        const parsed = parseField(schema, values[name], bools[name]);
        if (parsed !== undefined) input[name] = parsed;
      }
    } catch (error) {
      setRunning(false);
      setFail(error instanceof Error ? error.message : "Invalid form value");
      return;
    }
    try {
      const response = await client.runMutation(mutation.name, input);
      setResult(response.result);
    } catch (error) {
      if (isPlatformClientError(error) && error.errors?.length) {
        setErrors(error.errors);
        setFail(error.message);
      } else if (isPlatformClientError(error)) {
        setFail(error.message);
      } else {
        setFail(error instanceof Error ? error.message : "Mutation failed");
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <article
      className="space-y-3 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
      data-mutation-name={mutation.name}
    >
      <header>
        <h2 className="font-mono text-sm text-[var(--pf-fg)]">{mutation.name}</h2>
        <p className="mt-1 text-sm text-[var(--pf-muted)]">{mutation.description}</p>
        <p className="mt-1 text-xs text-[var(--pf-muted)]">roles: {mutation.roles.join(", ")}</p>
      </header>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun();
        }}
      >
        {fields.map(([name, schema]) => (
          <FieldControl
            key={name}
            name={name}
            schema={schema}
            text={values[name] ?? ""}
            bool={bools[name] ?? false}
            onText={(value) => setField(name, value)}
            onBool={(value) => setBools((current) => ({ ...current, [name]: value }))}
          />
        ))}
        <button
          type="submit"
          data-mutation-run={mutation.name}
          disabled={running}
          className="rounded-[var(--pf-radius)] bg-[var(--pf-accent)] px-3 py-2 text-sm text-[var(--pf-accent-fg)] disabled:opacity-60"
        >
          {running ? "Running…" : "Run"}
        </button>
      </form>
      {fail ? (
        <p className="text-sm text-[var(--pf-danger)]" role="alert" data-mutation-error="true">
          {fail}
        </p>
      ) : null}
      {errors ? (
        <ul className="text-xs text-[var(--pf-danger)]">
          {errors.map((item) => (
            <li key={`${item.path}:${item.message}`}>
              {item.path || "(root)"}: {item.message}
            </li>
          ))}
        </ul>
      ) : null}
      {result !== null ? (
        <pre
          className="overflow-x-auto rounded-[var(--pf-radius-sm)] bg-[var(--pf-bg)] p-3 text-xs text-[var(--pf-fg)]"
          data-mutation-result="true"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </article>
  );
}

function FieldControl({
  name,
  schema,
  text,
  bool,
  onText,
  onBool,
}: {
  name: string;
  schema: FieldSchema;
  text: string;
  bool: boolean;
  onText: (value: string) => void;
  onBool: (value: boolean) => void;
}) {
  const label = (
    <span className="block text-sm text-[var(--pf-muted)]">
      {name}
      {schema.required ? " *" : ""}
      <span className="ml-1 font-mono text-xs">{schema.type}</span>
    </span>
  );
  const inputClass =
    "mt-1 block w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]";

  if (schema.enum && (schema.type === "string" || schema.type === "number" || schema.type === "integer")) {
    return (
      <label>
        {label}
        <select className={inputClass} value={text} onChange={(event) => onText(event.target.value)}>
          <option value="">Select…</option>
          {schema.enum.map((entry) => (
            <option key={String(entry)} value={String(entry)}>
              {String(entry)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (schema.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-[var(--pf-fg)]">
        <input type="checkbox" checked={bool} onChange={(event) => onBool(event.target.checked)} />
        {name}
        {schema.required ? " *" : ""}
      </label>
    );
  }
  if (schema.type === "array" || schema.type === "object") {
    return (
      <label>
        {label}
        <textarea
          className={`${inputClass} h-24 font-mono text-xs`}
          value={text}
          placeholder={schema.type === "array" ? "[]" : "{}"}
          onChange={(event) => onText(event.target.value)}
        />
      </label>
    );
  }
  return (
    <label>
      {label}
      <input
        className={inputClass}
        type={schema.type === "number" || schema.type === "integer" ? "number" : "text"}
        value={text}
        onChange={(event) => onText(event.target.value)}
      />
    </label>
  );
}

function parseField(schema: FieldSchema, text: string | undefined, bool: boolean | undefined): unknown {
  if (schema.type === "boolean") return bool === true;
  const raw = text ?? "";
  if (raw.trim() === "") return undefined;
  if (schema.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error("Expected a number");
    return n;
  }
  if (schema.type === "integer") {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new Error("Expected an integer");
    return n;
  }
  if (schema.type === "array" || schema.type === "object") {
    return JSON.parse(raw) as unknown;
  }
  return raw;
}
