import { Link, Navigate } from 'react-router';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { Button, ButtonLink, Card, DefinitionRow, EmptyState, Loading, Notice, PageHeader, Pill, SourceLabel } from '../ui/components';
import { formatWhen, relativeDue } from '../ui/format';

export function AthleteHome() {
  const { api, viewer } = useApp();
  const { data, error, loading } = useLoad(() => api.getAthleteHome());
  const act = useAction();
  if (viewer && viewer.accountState !== 'active') return <Navigate to="/pending" replace />;
  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error}</Notice>;
  const req = data.latestRequest;
  const verifiedCoaches = data.coaches.filter((c) => c.verificationState === 'verified');
  return (
    <div className="space-y-4">
      <PageHeader title={`Hi ${data.displayName}`} subtitle={data.nextSession ? `Next: ${data.nextSession.title}, ${formatWhen(data.nextSession.startsAt)}` : 'No upcoming activity scheduled.'} />

      <Card className="border-brand bg-brand-soft">
        <h2 className="text-lg font-bold">Take 90 seconds</h2>
        <p className="mt-1 text-sm">Two questions about your last session. Private unless you choose to share.</p>
        <ButtonLink to={data.openAssignmentId ? `/reflect?assignment=${data.openAssignmentId}` : '/reflect'} className="mt-3 w-full">
          Reflect now
        </ButtonLink>
      </Card>

      <Card labelledBy="focus-h">
        <h2 id="focus-h" className="font-bold">Your focus</h2>
        {data.currentFocus ? (
          <dl className="mt-2">
            <DefinitionRow term="Now">
              {data.currentFocus.now} <SourceLabel source={data.currentFocus.authorRole === 'athlete' ? 'athlete_words' : 'coach_observation'} />
            </DefinitionRow>
            <DefinitionRow term="Next">
              <strong>{data.currentFocus.nextAction}</strong> — {data.currentFocus.nextSituation}. <span className="text-ink-soft">Measure: {data.currentFocus.nextMeasure}</span>
            </DefinitionRow>
            {data.currentFocus.northStar ? <DefinitionRow term="North star">{data.currentFocus.northStar}</DefinitionRow> : null}
          </dl>
        ) : (
          <EmptyState title="No focus yet">After your first reflection you can choose one NEXT action. Nothing is chosen for you.</EmptyState>
        )}
      </Card>

      {data.focusProposals.length ? (
        <Card labelledBy="prop-h">
          <h2 id="prop-h" className="font-bold">Suggested focus updates</h2>
          <p className="text-sm text-ink-soft">Nothing changes unless you accept it.</p>
          <ul className="mt-2 space-y-3">
            {data.focusProposals.map((f) => (
              <li key={f.id} className="rounded-lg border border-line p-3">
                <p className="text-sm">
                  From {f.authorName} <SourceLabel source="coach_observation" />
                </p>
                <p className="mt-1">
                  <strong>{f.nextAction}</strong> — {f.nextSituation}. Measure: {f.nextMeasure}
                </p>
                {f.northStar ? <p className="text-sm">North star: {f.northStar}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button busy={act.busy} onClick={() => act.run(() => api.acceptFocus(f.id))}>
                    Accept as my focus
                  </Button>
                  <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => api.declineFocus(f.id))}>
                    Keep my current focus
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card labelledBy="coach-h">
        <h2 id="coach-h" className="font-bold">Coach feedback</h2>
        {req ? (
          <div className="mt-2 space-y-1">
            <p>
              <Pill tone={req.label === 'Coach responded' ? 'ok' : req.label === 'Loop closed' ? 'brand' : 'neutral'}>{req.label}</Pill> with {req.coachName}
            </p>
            {['queued', 'waiting_for_coach', 'response_draft'].includes(req.request.state) ? (
              <p className="text-sm text-ink-soft">Response window ends {relativeDue(req.request.dueAt)}. Coaches are people — if it expires, nothing is marked complete.</p>
            ) : null}
            <Link to={`/feedback/${req.request.id}`} className="font-semibold text-brand underline">
              Open
            </Link>
          </div>
        ) : verifiedCoaches.length ? (
          <EmptyState title="No coach request yet">After you reflect, you can ask {verifiedCoaches[0]!.coachName} for one next step.</EmptyState>
        ) : (
          <EmptyState title="Personal reflection mode" action={<ButtonLink to="/coaches" variant="secondary">Invite your coach</ButtonLink>}>
            Your notebook works on its own. Loop never pretends to be a coach — invite your real one when you’re ready.
          </EmptyState>
        )}
      </Card>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
