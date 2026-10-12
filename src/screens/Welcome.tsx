import { Navigate } from 'react-router';
import { PRODUCT_PROMISE } from '../domain';
import { useApp } from '../app/context';
import { ButtonLink, Card, Loading } from '../ui/components';

export function homePathFor(v: NonNullable<ReturnType<typeof useApp>['viewer']>): string {
  if (v.athleteId) return v.accountState === 'active' ? '/home' : '/pending';
  if (v.isCoach) return '/coach';
  if (v.isGuardian) return '/guardian';
  if (v.staffRoles.length) return '/admin';
  return '/settings';
}

export function RootRedirect() {
  const { viewer, viewerLoaded } = useApp();
  if (!viewerLoaded) return <Loading />;
  if (!viewer) return <Navigate to="/welcome" replace />;
  return <Navigate to={homePathFor(viewer)} replace />;
}

export function Welcome() {
  return (
    <div className="space-y-6">
      <section className="pt-4" aria-labelledby="promise">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">Loop Athlete</p>
        <h1 id="promise" className="mt-1 text-3xl font-extrabold leading-tight">
          {PRODUCT_PROMISE}
        </h1>
        <p className="mt-3 text-ink-soft">
          Reflect in about 90 seconds after training or a game. Pick one next step. Ask the coach you already trust to respond — for free. No club or
          team needed to start.
        </p>
      </section>
      <div className="grid gap-3">
        <ButtonLink to="/start">Start as an athlete</ButtonLink>
        <ButtonLink to="/guardian/accept" variant="secondary">
          I’m a parent or guardian with an invite
        </ButtonLink>
        <ButtonLink to="/coach/accept" variant="secondary">
          I’m a coach with an invite
        </ButtonLink>
        <ButtonLink to="/login" variant="ghost">
          Log in
        </ButtonLink>
      </div>
      <Card>
        <h2 className="font-bold">How a loop works</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>You answer two questions: what you did well, and the moment you would like back.</li>
          <li>You choose one NEXT action. Your reflection stays private unless you choose to share part of it.</li>
          <li>Your real coach — verified by a person, not a bot — replies with one concrete action.</li>
        </ol>
        <p className="mt-2 text-sm text-ink-soft">Under 18? A parent or guardian activates your account first. They see support cues, not your diary.</p>
      </Card>
    </div>
  );
}
