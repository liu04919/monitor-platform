import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AuthGuard } from '@/features/auth/components/AuthGuard/AuthGuard'
import { EventDetailPage } from '@/pages/event-detail/EventDetailPage'
import { EventsPage } from '@/pages/events/EventsPage'
import { LoginPage } from '@/pages/login/LoginPage'
import { IssueDetailPage } from '@/pages/issue-detail/IssueDetailPage'
import { IssuesPage } from '@/pages/issues/IssuesPage'
import { ProjectSettingsPage } from '@/pages/project-settings/ProjectSettingsPage'
import { RegisterPage } from '@/pages/register/RegisterPage'
import { AppShell } from '@/widgets/app-shell/AppShell'
import { timeRangeLoader } from '@/features/time-range/model/timeRangeRouting'

export const appRoutes: RouteObject[] = [
  {
    path: 'login',
    element: <LoginPage />,
  },
  {
    path: 'register',
    element: <RegisterPage />,
  },
  {
    element: <AuthGuard />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/issues" replace /> },
          { path: 'issues', loader: timeRangeLoader, element: <IssuesPage /> },
          { path: 'issues/:issueId', loader: timeRangeLoader, element: <IssueDetailPage /> },
          { path: 'events', loader: timeRangeLoader, element: <EventsPage /> },
          { path: 'events/:eventId', element: <EventDetailPage /> },
          { path: 'projects/:projectId/settings', element: <ProjectSettingsPage /> },
          { path: '*', element: <Navigate to="/issues" replace /> },
        ],
      },
    ],
  },
]

export const appRouter = createBrowserRouter(appRoutes)
