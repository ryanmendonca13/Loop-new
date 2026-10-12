import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { GATE_MESSAGES, LIMITS } from '../domain';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { newIdempotencyKey } from '../lib/draftStore';
import { AudienceList, Button, Card, Checkbox, DefinitionRow, Loading, Notice, PageHeader, Pill, SourceLabel, TextArea } from '../ui/components';
import { formatWhen, relativeDue } from '../ui/format';

export function CoachRequest() {
  const { id = '' } = useParams();
  const { api } = useApp();
  const { data, error } = useLoad(() => api.getCoachRequest(id), [id]);
  const [summary, setSummary] = useState('');
  const [action, setAction] = useState('');
  const [situation, setSituation] = useState('');
  const [measure, setMeasure] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiUsed, setAiUsed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const publishKey = useRef(newIdempotencyKey('pub'));
  const act = useAction();
  const [brief, setBrief] = useState({ somethingToSay: '', questionToAsk: '', habitToPraise: '' });
  const [briefDone, setBriefDone] = useState(false);

  useEffect(() => {
    if (!data?.draft) return;
    setSummary(data.draft.summary);
    setAction(data.draft.oneNextAction);
    setSituation(data.draft.situation);
    setMeasure(data.draft.measure);
    setAiUsed(!!data.draft.aiModel);
  }, [data?.draft?.id, data?.draft?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const { request: q, draft, publication } = data;
  const open = ['waiting_for_coach', 'response_draft'].includes(q.state);
  const gates = data.audience.gateFailures;
  const dirty = !draft || draft.summary !== summary || draft.oneNextAction !== action || draft.situation !== situation || draft.measure !== measure;
  const complete = action.trim() && situation.trim() && measure.trim();
  const saveDraft = () => api.saveFeedbackDraft(q.id, { summary, oneNextAction: action, situation, measure }, draft?.version ?? null);

  return (
    <div className="space-y-4">
      <PageHeader title={`${data.athleteName} ${data.athleteRef}`} subtitle={<><Pill>{data.label}</Pill>{open ? ` · due ${relativeDue(q.dueAt)} (${formatWhen(q.dueAt)})` : ''}</>} />
      <Card>
        <h2 className="font-bold">What the athlete shared</h2>
        <dl className="mt-1">
          <DefinitionRow term="Excerpt">
            {q.sharedExcerpt} <SourceLabel source="athlete_words" />
          </DefinitionRow>
          <DefinitionRow term="Question">{q.question}</DefinitionRow>
          {data.focus ? <DefinitionRow term="Their current NEXT">{data.focus.nextAction} — {data.focus.nextSituation}</DefinitionRow> : null}
          {q.nextSessionAt ? <DefinitionRow term="Next session">{formatWhen(q.nextSessionAt)}</DefinitionRow> : null}
        </dl>
        <p className="mt-2 text-xs text-ink-soft">You see only what was shared for this request — not their diary.</p>
      </Card>
      <AudienceList members={data.audience.members} heading="Your response will be visible to" />
      {gates.length ? (
        <Notice tone="warn" title="Publishing is blocked">
          {gates.map((g) => GATE_MESSAGES[g]).join(' ')}
        </Notice>
      ) : null}

      {publication ? (
        <Card className="border-ok">
          <h2 className="font-bold">Published {formatWhen(publication.approvedAt)}</h2>
          <dl className="mt-1">
            <DefinitionRow term="One next action">{publication.oneNextAction}</DefinitionRow>
            <DefinitionRow term="When">{publication.situation}</DefinitionRow>
            <DefinitionRow term="Measure">{publication.measure}</DefinitionRow>
          </dl>
        </Card>
      ) : null}

      {open ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Your response</h2>
            <Button
              variant="secondary"
              busy={act.busy}
              onClick={async () => {
                setAiNote(null);
                const r = await act.run(() => api.requestAiSuggestion(q.id));
                if (!r) return;
                if (r.ok && r.draft) {
                  setSummary(r.draft.summary);
                  setAiUsed(true);
                  setAiNote(['Generated from the shared excerpt only. Check every word — you are the author.', ...r.warnings].join(' '));
                } else setAiNote(r.reason ?? 'No suggestion.');
              }}
            >
              Organize with AI (draft only)
            </Button>
          </div>
          {aiNote ? <Notice tone={aiUsed ? 'warn' : 'info'}>{aiNote}</Notice> : null}
          <TextArea label="Short note" hint="Optional. Kind and specific." value={summary} onChange={(v) => { setSummary(v); setPreviewing(false); }} max={LIMITS.feedbackSummaryMax} rows={3} />
          {aiUsed ? <SourceLabel source="generated_suggestion" /> : null}
          <TextArea label="One next action" hint="One thing they can do. Example: Shoot within two touches." value={action} onChange={(v) => { setAction(v); setPreviewing(false); }} max={LIMITS.actionMax} required rows={2} />
          <TextArea label="In which situation" hint="Example: When you receive at the edge of the box." value={situation} onChange={(v) => { setSituation(v); setPreviewing(false); }} max={LIMITS.situationMax} required rows={2} />
          <TextArea label="Simple measure" hint="Example: 3 first-time attempts next session." value={measure} onChange={(v) => { setMeasure(v); setPreviewing(false); }} max={LIMITS.measureMax} required rows={2} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" busy={act.busy} disabled={!dirty} onClick={() => act.run(saveDraft)}>
              Save draft (private)
            </Button>
            <Button
              busy={act.busy}
              disabled={!complete || gates.length > 0}
              onClick={async () => {
                if (dirty) await act.run(saveDraft);
                setConfirmed(false);
                setPreviewing(true);
              }}
            >
              Preview before publishing
            </Button>
          </div>
          <p className="text-xs text-ink-soft">Drafts are private to you. Nothing reaches the athlete until you publish.</p>
          {previewing && draft && !dirty ? (
            <div className="space-y-3 rounded-lg border-2 border-brand p-3">
              <h3 className="font-bold">Exactly what will be published</h3>
              {draft.summary ? <p>{draft.summary}</p> : null}
              <dl>
                <DefinitionRow term="One next action">{draft.oneNextAction}</DefinitionRow>
                <DefinitionRow term="When">{draft.situation}</DefinitionRow>
                <DefinitionRow term="Measure">{draft.measure}</DefinitionRow>
              </dl>
              <AudienceList members={data.audience.members} heading="To" />
              <Checkbox label={`I confirm the recipient (${data.athleteName} ${data.athleteRef}), the content and who can see it`} checked={confirmed} onChange={setConfirmed} />
              {draft.state !== 'reviewed' ? (
                <Button disabled={!confirmed} busy={act.busy} onClick={() => act.run(() => api.markReviewed(draft.id, draft.version, data.audience.hash))}>
                  Confirm review
                </Button>
              ) : (
                <Button
                  busy={act.busy}
                  onClick={() => act.run(() => api.publishFeedback({ draftId: draft.id, draftVersion: draft.version, confirmedAudienceHash: data.audience.hash, idempotencyKey: publishKey.current }))}
                >
                  Publish to {data.athleteName}
                </Button>
              )}
            </div>
          ) : null}
          <Button variant="ghost" onClick={() => window.confirm('Decline this request? The athlete is told you could not respond.') && act.run(() => api.declineRequest(q.id))}>
            I can’t respond to this one
          </Button>
        </Card>
      ) : null}

      {data.guardianLinks.length && publication ? (
        <Card className="space-y-3">
          <h2 className="font-bold">Optional: a support cue for {data.guardianLinks[0]!.guardianName}</h2>
          <p className="text-sm text-ink-soft">Three short cues in your own words. No quotes from the athlete, no scores or rankings. You review it again before it is published.</p>
          {briefDone ? (
            <Notice tone="success">Saved as a draft. Review and publish it from your inbox.</Notice>
          ) : (
            <>
              <TextArea label="Something to say" value={brief.somethingToSay} onChange={(v) => setBrief({ ...brief, somethingToSay: v })} max={LIMITS.briefFieldMax} required rows={2} />
              <TextArea label="A question to ask" value={brief.questionToAsk} onChange={(v) => setBrief({ ...brief, questionToAsk: v })} max={LIMITS.briefFieldMax} required rows={2} />
              <TextArea label="A habit to praise" value={brief.habitToPraise} onChange={(v) => setBrief({ ...brief, habitToPraise: v })} max={LIMITS.briefFieldMax} required rows={2} />
              <Button
                variant="secondary"
                busy={act.busy}
                disabled={!brief.somethingToSay.trim() || !brief.questionToAsk.trim() || !brief.habitToPraise.trim()}
                onClick={async () => {
                  const r = await act.run(() => api.createBrief({ athleteId: data.athleteId, guardianLinkId: data.guardianLinks[0]!.linkId, ...brief, sourceIds: publication ? [publication.id] : [] }));
                  if (r) setBriefDone(true);
                }}
              >
                Save support cue draft
              </Button>
            </>
          )}
        </Card>
      ) : null}
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
