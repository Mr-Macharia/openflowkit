import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseRepoPath } from '../../../../services/discovery/githubRepo';
import { isRepoMapAddress, repoMapDocumentId } from '../../../application/map/repoMapSource';
import type { V2StartIntent } from '../v2Document';
import { BrandLoader } from '../BrandLoader';
import { BadRepoAddress } from './V2RepoMapState';

/** `#/map/github/<owner>/<repo>[/tree/<ref>]`: a new document in the editor that is the repo's map. */
export function MapRoute(): React.JSX.Element {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // A doubled slash is a typo, not a different address.
  const asked = pathname.replace(/^\/map\/github\//, '').replace(/\/{2,}/g, '/');
  const repo = useMemo(() => {
    const parsed = parseRepoPath(asked);
    return parsed && isRepoMapAddress(parsed) ? parsed : null;
  }, [asked]);
  useEffect(() => {
    if (!repo) return;
    const repoMap = { owner: repo.owner, repo: repo.repo, ...(repo.ref !== 'HEAD' ? { ref: repo.ref } : {}) };
    // The same repo is always the same document: a revisit or bookmark reopens it instead of piling up copies.
    navigate(`/d/${repoMapDocumentId(repoMap)}`, { replace: true, state: { repoMap } satisfies V2StartIntent });
  }, [repo, navigate]);
  return repo ? <BrandLoader screen label="Opening the map" /> : <BadRepoAddress initial={asked} />;
}
