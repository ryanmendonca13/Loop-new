import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AudienceMember } from '../domain';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong disabled:bg-ink-soft/40',
  secondary: 'bg-card text-brand border border-brand hover:bg-brand-soft disabled:text-ink-soft/60 disabled:border-line',
  ghost: 'bg-transparent text-brand underline-offset-4 hover:underline disabled:text-ink-soft/60',
  danger: 'bg-card text-danger border border-danger hover:bg-danger-soft',
};

export function Button({ variant = 'primary', busy, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-semibold transition-colors disabled:cursor-not-allowed ${buttonStyles[variant]} ${className}`}
    >
      {busy ? <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', children, className = '' }: { to: string; variant?: ButtonVariant; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-semibold no-underline transition-colors ${buttonStyles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = '', as: Tag = 'section', labelledBy }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'li'; labelledBy?: string }) {
  return (
    <Tag aria-labelledby={labelledBy} className={`rounded-xl border border-line bg-card p-4 shadow-sm ${className}`}>
      {children}
    </Tag>
  );
}

/** Page title: receives focus on navigation so screen-reader users hear where they are. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    document.title = `${title} · Loop Athlete`;
  }, [title]);
  return (
    <header className="mb-4">
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-bold leading-tight focus:outline-none">
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-ink-soft">{subtitle}</p> : null}
    </header>
  );
}

type Tone = 'info' | 'success' | 'warn' | 'error';
const toneStyles: Record<Tone, string> = {
  info: 'bg-brand-soft text-ink border-brand/30',
  success: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  error: 'bg-danger-soft text-danger border-danger/30',
};
export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${toneStyles[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'warn' | 'ok' | 'danger' }) {
  const s = { neutral: 'bg-paper text-ink-soft border-line', brand: 'bg-brand-soft text-brand-strong border-brand/30', warn: 'bg-warn-soft text-warn border-warn/30', ok: 'bg-ok-soft text-ok border-ok/30', danger: 'bg-danger-soft text-danger border-danger/30' }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s}`}>{children}</span>;
}

/** Labels provenance so athlete words, coach observations and generated suggestions are never confused. */
export function SourceLabel({ source }: { source: 'athlete_words' | 'coach_observation' | 'generated_suggestion' | 'template' }) {
  const map = {
    athlete_words: { text: 'Your words', tone: 'neutral' as const },
    coach_observation: { text: 'Coach observation', tone: 'brand' as const },
    generated_suggestion: { text: 'Generated suggestion — not a coach', tone: 'warn' as const },
    template: { text: 'Template', tone: 'neutral' as const },
  }[source];
  return <Pill tone={map.tone}>{map.text}</Pill>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-card p-5 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function TextArea({ label, value, onChange, max, hint, required, rows = 3, id: idProp, name, autoFocus }: { label: string; value: string; onChange: (v: string) => void; max: number; hint?: string; required?: boolean; rows?: number; id?: string; name?: string; autoFocus?: boolean }) {
  const gen = useId();
  const id = idProp ?? gen;
  const over = value.length > max;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
        {required ? <span className="sr-only"> (required)</span> : <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      {hint ? <p id={`${id}-hint`} className="text-sm text-ink-soft">{hint}</p> : null}
      <textarea
        id={id}
        name={name}
        value={value}
        rows={rows}
        required={required}
        autoFocus={autoFocus}
        maxLength={max}
        aria-describedby={`${hint ? `${id}-hint ` : ''}${id}-count`}
        aria-invalid={over || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-white p-3 text-base leading-snug focus:border-brand"
      />
      <p id={`${id}-count`} className="self-end text-xs text-ink-soft" aria-live="off">
        {value.length}/{max}
      </p>
    </div>
  );
}

export function TextInput({ label, value, onChange, type = 'text', hint, required, max = 200, autoComplete, inputMode }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; required?: boolean; max?: number; autoComplete?: string; inputMode?: 'email' | 'text' }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
        {required ? <span className="sr-only"> (required)</span> : <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      {hint ? <p id={`${id}-hint`} className="text-sm text-ink-soft">{hint}</p> : null}
      <input id={id} type={type} value={value} required={required} maxLength={max} autoComplete={autoComplete} inputMode={inputMode} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)} className="min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base focus:border-brand" />
    </div>
  );
}

/** Shows exactly who will see a shared coaching exchange, before submission or publication. */
export function AudienceList({ members, heading = 'Who will see this' }: { members: AudienceMember[]; heading?: string }) {
  const roleText = { athlete: 'Athlete', coach: 'Coach', guardian: 'Guardian', second_adult: 'Second adult (guardian)' } as const;
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <p className="text-sm font-semibold">{heading}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {members.map((m) => (
          <li key={`${m.userId}-${m.role}`} className="flex flex-wrap items-center justify-between gap-2">
            <span>{m.displayName}</span>
            <span className="text-ink-soft">{roleText[m.role]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-soft">Nobody else can see this exchange. People who already viewed something cannot un-see it.</p>
    </div>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="py-6 text-center text-ink-soft">
      {label}…
    </p>
  );
}

export function DefinitionRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" />
      <div>
        <label htmlFor={id} className="font-medium">{label}</label>
        {hint ? <p id={`${id}-hint`} className="text-sm text-ink-soft">{hint}</p> : null}
      </div>
    </div>
  );
}
