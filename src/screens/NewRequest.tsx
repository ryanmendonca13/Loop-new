import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { GATE_MESSAGES, LIMITS, firstSentence } from '../domain';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { newIdempotencyKey } from '../lib/draftStore';
import type { AudiencePreview } from '../api/types';
import { AudienceList, Button, Card, Checkbox, Loading, Notice, PageHeader, TextArea } from '../ui/components';

export function NewRequest() {
  const [params] = useSearchParams();
  const reflectionId = params.get('reflection') ?? '';
  const { api } = useApp();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => Promise.all([api.getReflection(reflectionId), api.listCoaches()]), [reflectionId]);
  const [relId, setRelId] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [question, setQuestion] = useState('');
  const [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const key = useRef(newIdempotencyKey('req'));
  const act = useAction();

  useEffect(() => {
    if (!data) return;
    setExcerpt(firstSentence(data[0].answerMomentBack, LIMITS.excerptMax));
    const first = data[1].coaches.find((c) => c.verificationState === 'verified');
    if (first) setRelId(first.relationshipId);
  }, [data]);
  useEffect(() => {
    if (!relId) return;
    setConfirmed(false);
    api.previewAudience(relId).then(setAudience, () => setAudience(null));
  }, [api, relId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const coaches = data[1].coaches;
  const blocked = audience?.gateFailures.length ? audience.gateFailures : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Ask your coach" subtitle="Share one short part of your reflection and one question. The rest of your diary stays private." />
      {coaches.length === 0 ? (
        <Notice>
          No coaches yet. <Link to="/coaches" className="underline">Invite your coach</Link>.
        </Notice>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!audience) return;
          const r = await act.run(() => api.createLoopRequest({ reflectionId, coachRelationshipId: relId, sharedExcerpt: excerpt, question, confirmedAudienceHash: audience.hash, idempotencyKey: key.current }));
          if (r) navigate(`/feedback/${r.requestId}`, { replace: true });
        }}
      >
        <Card className="space-y-4">
          <fieldset>
            <legend className="font-semibold">Coach</legend>
            <div className="mt-2 grid gap-2">
              {coaches.map((c) => (
                <label key={c.relationshipId} className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 ${relId === c.relationshipId ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="coach" className="size-4 accent-[var(--color-brand)]" checked={relId === c.relationshipId} onChange={() => setRelId(c.relationshipId)} />
                    {c.coachName}
                  </span>
                  <span className="text-xs text-ink-soft">{c.verificationState === 'verified' ? 'Verified' : 'Not verified — cannot receive'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextArea label="What you’ll share" hint="Edit it down to just what your coach needs. This exact text is what they (and your second adult, if any) will see." value={excerpt} onChange={setExcerpt} max={LIMITS.excerptMax} required rows={3} />
          <TextArea label="Your question" hint="Example: What is one thing I can try next session?" value={question} onChange={setQuestion} max={LIMITS.questionMax} required rows={2} />
        </Card>
        {audience ? (
          <Card className="space-y-3">
            {blocked ? (
              <Notice tone="warn" title="This coach exchange can’t start yet">
                <ul className="list-disc pl-5">
                  {blocked.map((g) => (
                    <li key={g}>{GATE_MESSAGES[g]}</li>
                  ))}
                </ul>
                {blocked.some((g) => g.startsWith('second_adult')) ? <p className="mt-2">Ask your guardian to reconnect in Loop, or pick a different coach.</p> : null}
                {blocked.includes('coach_sharing_consent_missing') ? (
                  <p className="mt-2">
                    <Link to="/settings" className="underline">Turn on coach sharing in Settings</Link>.
                  </p>
                ) : null}
              </Notice>
            ) : (
              <>
                <AudienceList members={audience.members} />
                <Checkbox label="I’ve checked who will see this" checked={confirmed} onChange={setConfirmed} />
              </>
            )}
          </Card>
        ) : null}
        {act.error ? <Notice tone="error">{act.error}</Notice> : null}
        <Button type="submit" className="w-full" busy={act.busy} disabled={!audience || !!blocked || !confirmed || !excerpt.trim() || !question.trim()}>
          Send request
        </Button>
        <p className="text-center text-xs text-ink-soft">You can have one open coach request at a time. You can cancel it before your coach responds.</p>
      </form>
    </div>
  );
}
