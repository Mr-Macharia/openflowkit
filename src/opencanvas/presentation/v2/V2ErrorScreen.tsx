import { Button, ErrorState } from '../design-system';
import { V2StateHero } from './V2StateHero';
import { V2StateShell } from './V2StateShell';

/** The themed error page; loaded only after a crash so its styles stay out of the entry chunk. */
export function V2ErrorScreen({ reload }: { readonly reload: () => void }): React.JSX.Element {
  return (
    <V2StateShell testId="v2-error-boundary">
      <ErrorState
        hero={<V2StateHero kind="torn-page" />}
        title="Something went wrong"
        description="Reload to pick up where you left off."
        action={<Button variant="primary" onClick={reload}>Reload</Button>}
      />
    </V2StateShell>
  );
}
