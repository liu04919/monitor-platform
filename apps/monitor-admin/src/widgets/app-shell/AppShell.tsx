import { NavLink, Outlet, useMatch } from 'react-router-dom'
import { EventsIcon, ChevronIcon, PulseIcon } from '@/shared/ui/icons/Icons'
import { useAdminStore } from '@/store/adminStore'
import styles from './AppShell.module.css'

export function AppShell() {
  const projectId = useAdminStore((state) => state.projectId)
  const detailMatch = useMatch('/events/:eventId')

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandLockup}>
          <span className={styles.brandMark}><PulseIcon /></span>
          <span><strong>Monitor</strong><small>Admin</small></span>
        </div>
        <div className={styles.projectContext}>
          <span>当前项目</span><strong>{projectId}</strong><small>本地遥测项目</small>
        </div>
        <nav aria-label="管理端导航">
          <NavLink to="/events" className={({ isActive }) => isActive ? styles.active : undefined} end>
            <EventsIcon /><span>事件流</span>
          </NavLink>
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.connectionDot} />
          <span><strong>LOCAL ADMIN</strong><small>服务端代理鉴权</small></span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}><span className={styles.brandMark}><PulseIcon /></span><strong>Monitor</strong></div>
          <nav aria-label="面包屑">
            <NavLink to="/events">事件流</NavLink>
            {detailMatch ? <><ChevronIcon /><span>事件详情</span></> : null}
          </nav>
          <div className={styles.projectChip}><span />{projectId}</div>
        </header>
        <main><Outlet /></main>
      </div>
    </div>
  )
}
