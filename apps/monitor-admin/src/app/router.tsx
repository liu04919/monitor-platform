import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom'
import { EventDetailPage } from '@/pages/event-detail/EventDetailPage'
import { EventsPage } from '@/pages/events/EventsPage'
import { AppShell } from '@/widgets/app-shell/AppShell'

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/events" replace /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:eventId', element: <EventDetailPage /> },
      { path: '*', element: <Navigate to="/events" replace /> },
    ],
  },
]

export const appRouter = createBrowserRouter(appRoutes)
