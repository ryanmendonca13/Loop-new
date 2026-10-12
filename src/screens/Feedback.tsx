import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { AudienceList, Button, Card, DefinitionRow, Loading, Notice, PageHeader, Pill, SourceLabel } from '../ui/components';
import { formatWhen, relativeDue } from '../ui/format';

export function Feedback() {
  const { id = '' } = useParams();
  const { api, viewer } = useApp();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => api.getFeedback(id), [id]);
  const act = useAction();
  const [chosen, setChosen] = useState(false);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const { request: q, publication: p } = data;
  const open = ['queued', 'waiting_for_coach', 'response_draft'].includes(q.state);
  const sameAsFocus = p && data.currentFocus?.nextAction === p.oneNextAction;
  return (
    <div className="space-y-4">
      <PageHeader title="Coach feedback" subtitle={<><Pill tone={p ? 'ok' : 'neutral'}>{data.label}</Pill> · {data.coachName}</>} />
      <Card>
        <h2 className="font-bold">What you shared</h2>
        <dl className="mt-1">
          <DefinitionRow term="Excerpt">
            {q.sharedExcerpt} <SourceLabel source="athlete_words" />
          </DefinitionRow>
          <DefinitionRow term="Question">{q.question}</DefinitionRow>
        </dl>
        <div className="mt-2">
          <AudienceList members={q.audience.members} heading="Who can see this exchange" />
        </div>
      </Card>
      {p ? (
        <Card className="border-ok">
          <h2 className="font-bold">
            From {data.coachName} <SourceLabel source="coach_observation" />
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            {data.coachVerified ? 'Verified coach' : 'Coach access has since changed'} · published {formatWhen(p.approvedAt)}
            {p.version > 1 ? ` · corrected (version ${p.version})` : ''}
          </p>
          {p.summary ? <p className="mt-2">{p.summary}</p> : null}
          <dl className="mt-2 rounded-lg bg-ok-soft p-3">
            <DefinitionRow term="One next action">
              <strong>{p.oneNextAction}</strong>
            </DefinitionRow>
            <DefinitionRow term="When">{p.situation}</DefinitionRow>
            <DefinitionRow term="Measure">{p.measure}</DefinitionRow>
          </dl>
          <div className="mt-3 space-y-2">
            {q.state === 'published' ? (
              <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => api.acknowledgeFeedback(q.id, false))}>
                Mark as read
              </Button>
            ) : (
              <p className="text-sm">{q.state === 'closed' ? 'Loop closed.' : 'You’ve read this.'}</p>
            )}
          </div>
        </Card>
      ) : open ? (
        <Card>
          <p>Waiting for {data.coachName}. Response window ends {relativeDue(q.dueAt)}.</p>
          <p className="mt-1 text-sm text-ink-soft">Coaches respond as people, in their own time. If the window passes it is marked expired — never complete.</p>
          <Button variant="danger" className="mt-3" busy={act.busy} onClick={() => window.confirm('Cancel this request?') && act.run(() => api.cancelLoopRequest(q.id))}>
            Cancel request
          </Button>
        </Card>
      ) : (
        <Notice>This request is {data.label.toLowerCase()}. Nothing was marked as complete.</Notice>
      )}
      {p && viewer?.athleteId && ['published', 'athlete_acknowledged'].includes(q.state) ? (
        <Card>
          <h2 className="font-bold">Your NEXT</h2>
          <p className="text-sm text-ink-soft">You decide. Your current focus only changes if you choose to.</p>
          {data.currentFocus ? <p className="mt-2 text-sm">Current NEXT: {data.currentFocus.nextAction}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!sameAsFocus ? (
              <Button
                busy={act.busy}
                onClick={async () => {
                  const r = await act.run(async () => {
                    await api.proposeFocus({ athleteId: viewer.athleteId!, now: q.sharedExcerpt.slice(0, 240), nextAction: p.oneNextAction, nextSituation: p.situation, nextMeasure: p.measure, northStar: data.currentFocus?.northStar ?? null, categories: data.currentFocus?.categories ?? [], sourceIds: [q.reflectionId, p.id], changeReason: `Chose NEXT after ${data.coachName}'s feedback`, accept: true });
                    await api.acknowledgeFeedback(q.id, true);
                  });
                  if (r !== undefined) setChosen(true);
                }}
              >
                Make this my NEXT
              </Button>
            ) : null}
            <Button variant="secondary" busy={act.busy} onClick={async () => (await act.run(() => api.acknowledgeFeedback(q.id, true))) !== undefined && setChosen(true)}>
              Keep my current focus
            </Button>
          </div>
        </Card>
      ) : null}
      {chosen || q.state === 'closed' ? (
        <Notice tone="success" title="Loop closed">
          Your coach responded and you chose your next step.{' '}
          <button type="button" className="underline" onClick={() => navigate('/home')}>
            Back to home
          </button>
        </Notice>
      ) : null}
      {data.history.length > 1 ? (
        <Card>
          <h2 className="font-bold">Earlier versions</h2>
          <ul className="mt-1 text-sm">
            {data.history.filter((h) => !h.isCurrent).map((h) => (
              <li key={h.id}>
                v{h.version}: {h.oneNextAction} (replaced)
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
