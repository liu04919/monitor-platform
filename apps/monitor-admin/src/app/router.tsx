import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AuthGuard } from '@/features/auth/components/AuthGuard/AuthGuard'
import { EventDetailPage } from '@/pages/event-detail/EventDetailPage'
import { EventsPage } from '@/pages/events/EventsPage'
import { LoginPage } from '@/pages/login/LoginPage'
import { ProjectSettingsPage } from '@/pages/project-settings/ProjectSettingsPage'
import { RegisterPage } from '@/pages/register/RegisterPage'
import { AppShell } from '@/widgets/app-shell/AppShell'

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
          { index: true, element: <Navigate to="/events" replace /> },
          { path: 'events', element: <EventsPage /> },
          { path: 'events/:eventId', element: <EventDetailPage /> },
          { path: 'projects/:projectId/settings', element: <ProjectSettingsPage /> },
          { path: '*', element: <Navigate to="/events" replace /> },
        ],
      },
    ],
  },
]

export const appRouter = createBrowserRouter(appRoutes)
