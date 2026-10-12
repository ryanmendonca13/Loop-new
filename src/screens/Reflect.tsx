import { useEffect, useId, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { CORE_PROMPT_MOMENT_BACK, CORE_PROMPT_WELL, LIMITS, MOOD_OPTIONS } from '../domain';
import { useApp } from '../app/context';
import { errorMessage, useAction } from '../app/hooks';
import { clearLocalDraft, loadLocalDraft, newIdempotencyKey, saveLocalDraft } from '../lib/draftStore';
import { Button, Card, Loading, Notice, PageHeader, TextArea } from '../ui/components';

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export function Reflect() {
  const { api, viewer, config } = useApp();
  const [params] = useSearchParams();
  const assignmentId = params.get('assignment');
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [well, setWell] = useState('');
  const [back, setBack] = useState('');
  const [support, setSupport] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const [restore, setRestore] = useState<ReturnType<typeof loadLocalDraft>>(null);
  const [voice, setVoice] = useState<{ text: string; target: 'well' | 'back' } | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const reflectionId = useRef<string | null>(null);
  const version = useRef<number | null>(null);
  const dirty = useRef(false);
  // One idempotency key per reflection attempt: double taps and retries submit exactly once.
  const submitKey = useRef(newIdempotencyKey('submit'));
  const act = useAction();
  const moodId = useId();

  useEffect(() => {
    if (!viewer) return;
    let alive = true;
    api.getDraft(assignmentId).then(
      (d) => {
        if (!alive) return;
        if (d) {
          reflectionId.current = d.id;
          version.current = d.version;
          setWell(d.answerWell);
          setBack(d.answerMomentBack);
          setSupport(d.supportRequest ?? '');
          setMood(d.mood);
        }
        const local = loadLocalDraft(viewer.userId, assignmentId);
        if (local && (!d || local.savedAt > new Date(d.updatedAt).getTime()) && (local.answerWell || local.answerMomentBack)) setRestore(local);
        setReady(true);
      },
      () => setReady(true),
    );
    return () => {
      alive = false;
    };
  }, [api, viewer, assignmentId]);

  // Local autosave immediately; server autosave debounced.
  useEffect(() => {
    if (!ready || !viewer || !dirty.current) return;
    saveLocalDraft({ userId: viewer.userId, assignmentId, reflectionId: reflectionId.current, answerWell: well, answerMomentBack: back, supportRequest: support, mood });
    setSave('saving');
    const t = setTimeout(async () => {
      try {
        const r = await api.saveDraft({ reflectionId: reflectionId.current, assignmentId, answerWell: well, answerMomentBack: back, supportRequest: support || null, mood, expectedVersion: version.current });
        reflectionId.current = r.reflectionId;
        version.current = r.version;
        setSave('saved');
      } catch (e) {
        setSave(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        act.setError(errorMessage(e));
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [well, back, support, mood, ready]);

  if (viewer && viewer.accountState !== 'active') return <Navigate to="/pending" replace />;
  if (!ready) return <Loading />;
  const edit = (setter: (v: string) => void) => (v: string) => {
    dirty.current = true;
    setter(v);
  };
  const canSubmit = well.trim().length > 0 && back.trim().length > 0;
  const saveText: Record<SaveState, string> = { idle: '', saving: 'Saving draft…', saved: 'Draft saved', offline: 'Offline — saved on this device for 24 hours', error: 'Could not save to the server — kept on this device' };

  return (
    <div className="space-y-4">
      <PageHeader title="Reflect" subtitle="About 90 seconds. Only you can see this unless you choose to share part of it." />
      {restore ? (
        <Notice tone="info" title="Unsaved writing found on this device">
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                dirty.current = true;
                setWell(restore.answerWell);
                setBack(restore.answerMomentBack);
                setSupport(restore.supportRequest);
                setMood(restore.mood);
                setRestore(null);
              }}
            >
              Restore it
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clearLocalDraft(viewer!.userId, assignmentId);
                setRestore(null);
              }}
            >
              Discard
            </Button>
          </div>
        </Notice>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          const r = await act.run(() =>
            api.submitReflection({ reflectionId: reflectionId.current, assignmentId, answerWell: well, answerMomentBack: back, supportRequest: support || null, mood, idempotencyKey: submitKey.current }),
          );
          if (r) {
            clearLocalDraft(viewer!.userId, assignmentId);
            navigate(`/reflect/done/${r.reflectionId}`, { replace: true });
          }
        }}
      >
        <Card className="space-y-4">
          <TextArea label={CORE_PROMPT_WELL} value={well} onChange={edit(setWell)} max={LIMITS.answerMax} required rows={3} name="answerWell" />
          <TextArea label={CORE_PROMPT_MOMENT_BACK} value={back} onChange={edit(setBack)} max={LIMITS.answerMax} required rows={3} name="answerMomentBack" />
          {config.flags.voice ? (
            <div className="rounded-lg border border-line bg-paper p-3 text-sm">
              <p className="font-semibold">Prefer to talk? (optional)</p>
              <p className="text-ink-soft">Voice needs its own consent. You always review and edit the text before it is saved. Typing always works.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['well', 'back'] as const).map((target) => (
                  <Button
                    key={target}
                    variant="secondary"
                    onClick={async () => {
                      setVoiceError(null);
                      try {
                        const r = await api.simulateVoiceTranscript();
                        setVoice({ text: r.transcript, target });
                      } catch (e) {
                        setVoiceError(errorMessage(e));
                      }
                    }}
                  >
                    Speak answer {target === 'well' ? '1' : '2'}
                  </Button>
                ))}
              </div>
              {voiceError ? <p className="mt-2 text-danger">{voiceError}</p> : null}
              {voice ? (
                <div className="mt-3 space-y-2">
                  <TextArea label="Transcript (simulated — edit before using)" value={voice.text} onChange={(t) => setVoice({ ...voice, text: t })} max={LIMITS.answerMax} required />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        dirty.current = true;
                        (voice.target === 'well' ? setWell : setBack)(voice.text.replace(/^SIMULATED TRANSCRIPT — edit before saving: /, ''));
                        setVoice(null);
                      }}
                    >
                      Use this text
                    </Button>
                    <Button variant="ghost" onClick={() => setVoice(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <Button variant="ghost" aria-expanded={showOptional} onClick={() => setShowOptional((s) => !s)}>
              {showOptional ? 'Hide optional questions' : 'Add optional details'}
            </Button>
          </div>
          {showOptional ? (
            <div className="space-y-4">
              <fieldset aria-describedby={`${moodId}-hint`}>
                <legend className="font-semibold">
                  How did it feel overall? <span className="font-normal text-ink-soft">(optional)</span>
                </legend>
                <p id={`${moodId}-hint`} className="text-sm text-ink-soft">
                  Skip it any time. Leaving it blank is recorded as blank, not as a low score.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...MOOD_OPTIONS, { value: null, label: 'Skip' }].map((o) => (
                    <label key={String(o.value)} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${mood === o.value ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                      <input
                        type="radio"
                        name="mood"
                        className="size-4 accent-[var(--color-brand)]"
                        checked={mood === o.value}
                        onChange={() => {
                          dirty.current = true;
                          setMood(o.value);
                        }}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <TextArea label="Anything you want support with?" hint="Only visible to you unless you include it when asking your coach." value={support} onChange={edit(setSupport)} max={LIMITS.supportRequestMax} rows={2} />
            </div>
          ) : null}
        </Card>
        <p aria-live="polite" className="min-h-5 text-sm text-ink-soft">
          {saveText[save]}
        </p>
        {act.error ? <Notice tone="error">{act.error}</Notice> : null}
        <Button type="submit" className="w-full" busy={act.busy} disabled={!canSubmit}>
          Save reflection
        </Button>
        <p className="text-center text-xs text-ink-soft">Saved privately. Next you can organize it yourself or ask your coach.</p>
      </form>
    </div>
  );
}
