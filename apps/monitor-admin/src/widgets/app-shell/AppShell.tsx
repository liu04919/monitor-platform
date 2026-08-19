import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router-dom";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher/ProjectSwitcher";
import { projectsQueryOptions } from "@/features/projects/model/projectQueries";
import { EventsIcon, ChevronIcon, PulseIcon } from "@/shared/ui/icons/Icons";
import { useAdminStore } from "@/store/adminStore";
import styles from "./AppShell.module.css";

export function AppShell() {
  const projectId = useAdminStore((state) => state.projectId);
  const setProjectId = useAdminStore((state) => state.setProjectId);
  const projectsQuery = useQuery(projectsQueryOptions());
  const projects = projectsQuery.data?.projects || [];
  const selectedProject = projects.find((project) => project.id === projectId);
  const fallbackProjectId = projects.length > 0 && !selectedProject ? projects[0].id : "";
  const detailMatch = useMatch("/events/:eventId");
  const navigate = useNavigate();

  useEffect(() => {
    if (fallbackProjectId) setProjectId(fallbackProjectId);
  }, [fallbackProjectId, setProjectId]);

  const switchProject = (nextProjectId: string) => {
    if (nextProjectId === projectId) return;
    setProjectId(nextProjectId);
    navigate("/events");
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandLockup}>
          <span className={styles.brandMark}>
            <PulseIcon />
          </span>
          <span>
            <strong>Monitor</strong>
            <small>Admin</small>
          </span>
        </div>
        <ProjectSwitcher
          projects={projects}
          projectId={projectId}
          isLoading={projectsQuery.isPending}
          isError={projectsQuery.isError}
          onChange={switchProject}
        />
        <nav aria-label="管理端导航">
          <NavLink
            to="/events"
            className={({ isActive }) => (isActive ? styles.active : undefined)}
            end
          >
            <EventsIcon />
            <span>事件流</span>
          </NavLink>
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.connectionDot} />
          <span>
            <strong>LOCAL ADMIN</strong>
            <small>服务端代理鉴权</small>
          </span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.mobileBrand}>
            <span className={styles.brandMark}>
              <PulseIcon />
            </span>
            <strong>Monitor</strong>
          </div>
          <nav aria-label="面包屑">
            <NavLink to="/events">事件流</NavLink>
            {detailMatch ? (
              <>
                <ChevronIcon />
                <span>事件详情</span>
              </>
            ) : null}
          </nav>
          <div className={styles.projectChip} title={projectId}>
            <span />
            {selectedProject?.name || projectId}
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
