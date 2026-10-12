import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useApp } from './context';
import { Shell } from './Shell';
import { Loading } from '../ui/components';
import { RootRedirect, Welcome } from '../screens/Welcome';
import { Login } from '../screens/Login';
import { Start } from '../screens/Start';
import { Pending } from '../screens/Pending';
import { AthleteHome } from '../screens/AthleteHome';
import { Reflect } from '../screens/Reflect';
import { ReflectDone } from '../screens/ReflectDone';
import { Solo } from '../screens/Solo';
import { Coaches } from '../screens/Coaches';
import { NewRequest } from '../screens/NewRequest';
import { Feedback } from '../screens/Feedback';
import { Profile } from '../screens/Profile';
import { AcceptInvite } from '../screens/AcceptInvite';
import { GuardianHome } from '../screens/GuardianHome';
import { CoachInbox } from '../screens/CoachInbox';
import { CoachRequest } from '../screens/CoachRequest';
import { Settings } from '../screens/Settings';
import { Admin } from '../screens/Admin';
import { FeatureOff, TeamCoverage } from '../screens/Flagged';
import { NotFound } from '../screens/NotFound';

/** UX guard only. Authorization is enforced by the backend on every call. */
function Private({ children }: { children: ReactNode }) {
  const { viewer, viewerLoaded } = useApp();
  if (!viewerLoaded) return <Loading />;
  if (!viewer) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<RootRedirect />} />
        <Route path="welcome" element={<Welcome />} />
        <Route path="login" element={<Login />} />
        <Route path="start" element={<Start />} />
        <Route path="guardian/accept" element={<AcceptInvite kind="guardian" />} />
        <Route path="coach/accept" element={<AcceptInvite kind="coach" />} />
        <Route path="pending" element={<Private><Pending /></Private>} />
        <Route path="home" element={<Private><AthleteHome /></Private>} />
        <Route path="reflect" element={<Private><Reflect /></Private>} />
        <Route path="reflect/done/:id" element={<Private><ReflectDone /></Private>} />
        <Route path="solo/:id" element={<Private><Solo /></Private>} />
        <Route path="coaches" element={<Private><Coaches /></Private>} />
        <Route path="request/new" element={<Private><NewRequest /></Private>} />
        <Route path="feedback/:id" element={<Private><Feedback /></Private>} />
        <Route path="profile" element={<Private><Profile /></Private>} />
        <Route path="guardian" element={<Private><GuardianHome /></Private>} />
        <Route path="coach" element={<Private><CoachInbox /></Private>} />
        <Route path="coach/request/:id" element={<Private><CoachRequest /></Private>} />
        <Route path="coach/team" element={<Private><TeamCoverage /></Private>} />
        <Route path="director" element={<Private><FeatureOff name="Director view" /></Private>} />
        <Route path="settings" element={<Private><Settings /></Private>} />
        <Route path="admin" element={<Private><Admin /></Private>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
