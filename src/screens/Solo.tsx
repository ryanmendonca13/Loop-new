import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { FOCUS_CATEGORIES, FOCUS_CATEGORY_LABELS, LIMITS, type FocusCategory } from '../domain';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { Button, Card, Checkbox, DefinitionRow, Loading, Notice, PageHeader, SourceLabel, TextArea } from '../ui/components';

export function Solo() {
  const { id = '' } = useParams();
  const { api, viewer } = useApp();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => api.organizeSolo(id), [id]);
  const [action, setAction] = useState('');
  const [situation, setSituation] = useState('');
  const [measure, setMeasure] = useState('');
  const [north, setNorth] = useState('');
  const [keepNorth, setKeepNorth] = useState(true);
  const [cats, setCats] = useState<FocusCategory[]>([]);
  const act = useAction();
  useEffect(() => {
    if (data?.currentNorthStar) setNorth(data.currentNorthStar);
  }, [data]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data || !viewer?.athleteId) return <Loading />;
  const northStar = data.currentNorthStar && keepNorth ? data.currentNorthStar : north.trim() || null;
  return (
    <div className="space-y-4">
      <PageHeader title="Your NOW · NEXT · NORTH STAR" subtitle={data.disclaimer} />
      <Card>
        <dl>
          <DefinitionRow term="Now — the moment you want back">
            {data.now.text} <SourceLabel source="athlete_words" />
          </DefinitionRow>
          <DefinitionRow term="Something you did well">
            {data.strength.text} <SourceLabel source="athlete_words" />
          </DefinitionRow>
        </dl>
      </Card>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act.run(() =>
            api.proposeFocus({ athleteId: viewer.athleteId!, now: data.now.text.slice(0, LIMITS.focusFieldMax), nextAction: action, nextSituation: situation, nextMeasure: measure, northStar, categories: cats, sourceIds: [data.sourceId], changeReason: 'Chosen after my reflection', accept: true }),
          );
          if (r) navigate('/home');
        }}
      >
        <Card className="space-y-4">
          <h2 className="font-bold">NEXT — one action, one situation, one simple measure</h2>
          <p className="text-sm text-ink-soft">Write it in your own words. Loop does not pick it for you.</p>
          <TextArea label="I will…" hint="Example: call for the ball early" value={action} onChange={setAction} max={LIMITS.actionMax} required rows={2} />
          <TextArea label="When…" hint="Example: when our keeper has the ball" value={situation} onChange={setSituation} max={LIMITS.situationMax} required rows={2} />
          <TextArea label="I’ll know it worked if…" hint="Example: I call at least 3 times" value={measure} onChange={setMeasure} max={LIMITS.measureMax} required rows={2} />
          <fieldset>
            <legend className="font-semibold">
              Tag it <span className="font-normal text-ink-soft">(optional — not a diagnosis)</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {FOCUS_CATEGORIES.map((c) => {
                const suggested = data.suggestedCategories.some((s) => s.category === c);
                return (
                  <label key={c} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 ${cats.includes(c) ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                    <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={cats.includes(c)} onChange={(e) => setCats((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))} />
                    {FOCUS_CATEGORY_LABELS[c]}
                    {suggested ? <span className="text-xs text-ink-soft">(suggested from your words)</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-bold">NORTH STAR — your longer-term direction</h2>
          {data.currentNorthStar ? <Checkbox label={`Keep: “${data.currentNorthStar}”`} checked={keepNorth} onChange={setKeepNorth} /> : null}
          {!data.currentNorthStar || !keepNorth ? <TextArea label="My north star" hint="Optional. Only you approve this." value={north} onChange={setNorth} max={LIMITS.focusFieldMax} rows={2} /> : null}
        </Card>
        {act.error ? <Notice tone="error">{act.error}</Notice> : null}
        <Button type="submit" className="w-full" busy={act.busy} disabled={!action.trim() || !situation.trim() || !measure.trim()}>
          Make this my focus
        </Button>
        <p className="text-center text-xs text-ink-soft">This is a personal reflection, not coach feedback. Your previous focus is kept in your history.</p>
      </form>
    </div>
  );
}
