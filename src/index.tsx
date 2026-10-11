import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startFeedbackSession } from './services/feedback/feedbackSession';
import { entryOf, isViewerRoute, startUsage } from './services/usage/usage';
import './index.css';

// v1 shared `/view?flow=…` without a hash too; move it under the hash router (v1 did the same).
const { pathname, search, hash } = window.location;
if (!hash && pathname.endsWith('/view') && new URLSearchParams(search).has('flow')) {
  window.history.replaceState(null, '', `${pathname.slice(0, -'view'.length)}#/view${search}`);
}

startUsage({ entry: entryOf(window.location.hash) });
startFeedbackSession(Date.now(), isViewerRoute(window.location.hash));

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
