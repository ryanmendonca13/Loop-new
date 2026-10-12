import { useParams } from 'react-router';
import { useApp } from '../app/context';
import { useLoad } from '../app/hooks';
import { ButtonLink, Card, Loading, Notice, PageHeader } from '../ui/components';

export function ReflectDone() {
  const { id = '' } = useParams();
  const { api } = useApp();
  const { data, error } = useLoad(() => Promise.all([api.getReflection(id), api.listCoaches()]), [id]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const verified = data[1].coaches.filter((c) => c.verificationState === 'verified');
  return (
    <div className="space-y-4">
      <PageHeader title="Reflection saved" subtitle="Private to you. Nobody else can see it." />
      <Notice tone="success" title="Saved once">
        Even if you tapped twice or lost signal, it was stored a single time.
      </Notice>
      <Card>
        <h2 className="font-bold">What next?</h2>
        <div className="mt-3 grid gap-2">
          <ButtonLink to={`/solo/${id}`}>Choose my NEXT step</ButtonLink>
          {verified.length ? (
            <ButtonLink to={`/request/new?reflection=${id}`} variant="secondary">
              Ask my coach for one next step
            </ButtonLink>
          ) : (
            <ButtonLink to="/coaches" variant="secondary">
              Invite my coach
            </ButtonLink>
          )}
          <ButtonLink to="/home" variant="ghost">
            Done for now
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
