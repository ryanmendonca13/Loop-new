import { useApp } from '../app/context';
import { useLoad } from '../app/hooks';
import { Card, Loading, Notice, PageHeader } from '../ui/components';
import { DEFAULTS } from '../domain';

export function FeatureOff({ name }: { name: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title={name} />
      <Notice>This is a later (P1) feature and is turned off in this build. It needs owner approval before it can be enabled.</Notice>
    </div>
  );
}

export function TeamCoverage() {
  const { api, config } = useApp();
  const { data, error } = useLoad(() => (config.flags.teamTools ? api.getTeamCoverage() : Promise.resolve([])));
  if (!config.flags.teamTools) return <FeatureOff name="Team tools" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Team coverage" subtitle="Last 28 days. Canceled sessions and inactive members are excluded." />
      {data.map((c) => (
        <Card key={c.key}>
          <h2 className="font-bold">{c.label}</h2>
          {c.suppressed ? <p className="text-sm text-ink-soft">{c.reason ?? `Hidden: fewer than ${DEFAULTS.minCohortSize} athletes.`}</p> : <p>{c.completed} of {c.expected} expected reflections completed{c.rate !== null && c.rate !== undefined ? ` (${Math.round(c.rate * 100)}%)` : ''}.</p>}
          <p className="mt-1 text-xs text-ink-soft">Completion is a count of reflections, not a judgment of any athlete.</p>
        </Card>
      ))}
    </div>
  );
}
