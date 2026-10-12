import { ButtonLink, PageHeader } from '../ui/components';
export function NotFound() {
  return (
    <div className="space-y-4">
      <PageHeader title="Page not found" subtitle="Or you may not have access to it." />
      <ButtonLink to="/">Go home</ButtonLink>
    </div>
  );
}
