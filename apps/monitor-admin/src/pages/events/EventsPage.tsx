import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { EventFilters } from "@/features/events/components/EventFilters/EventFilters";
import { EventTable } from "@/features/events/components/EventTable/EventTable";
import { eventErrorMessage } from "@/features/events/model/eventFormatters";
import { eventsQueryOptions } from "@/features/events/model/eventQueries";
import type {
  EventCategory,
  EventFilters as Filters,
} from "@/features/events/model/eventTypes";
import {
  ErrorState,
  EmptyState,
  InlineError,
  LoadingRows,
} from "@/shared/ui/feedback/AsyncFeedback";
import { RefreshIcon } from "@/shared/ui/icons/Icons";
import { useAdminStore } from "@/store/adminStore";
import styles from "./EventsPage.module.css";

const supportedCategories = new Set<EventCategory>([
  "error",
  "performance",
  "behavior",
  "stability",
  "ai",
]);

export function EventsPage() {
  const projectId = useAdminStore((state) => state.projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryValue = searchParams.get("category") || "";
  const eventType = searchParams.get("eventType")?.trim() || "";
  const category = supportedCategories.has(categoryValue as EventCategory)
    ? (categoryValue as EventCategory)
    : "";
  const filters = useMemo<Filters>(
    () => ({ category, eventType }),
    [category, eventType],
  );
  const query = useInfiniteQuery(eventsQueryOptions(projectId, filters));
  const events = query.data?.pages.flatMap((page) => page.events) || [];
  const hasFilters = Boolean(category || eventType);

  const applyFilters = (nextFilters: Filters) => {
    const next = new URLSearchParams();
    if (nextFilters.category) next.set("category", nextFilters.category);
    if (nextFilters.eventType) next.set("eventType", nextFilters.eventType);
    setSearchParams(next);
  };

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>TELEMETRY EXPLORER</p>
          <h1>事件流</h1>
          <p>浏览由浏览器 SDK 上报并写入 ClickHouse 的原始事件。</p>
        </div>
        <button
          className={styles.refreshButton}
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          aria-label="刷新事件"
        >
          <RefreshIcon />
        </button>
      </div>

      <EventFilters
        key={`${category}:${eventType}`}
        value={filters}
        onApply={applyFilters}
      />

      <div className={styles.panel}>
        {query.isPending ? <LoadingRows /> : null}
        {query.isError && events.length === 0 ? (
          <ErrorState
            message={eventErrorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!query.isPending && !query.isError && events.length === 0 ? (
          <EmptyState filtered={hasFilters} />
        ) : null}
        {events.length > 0 ? (
          <EventTable
            events={events}
            hasNextPage={query.hasNextPage}
            isFetchingNextPage={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        ) : null}
      </div>
      {query.isFetchNextPageError ? (
        <InlineError
          message={eventErrorMessage(query.error)}
          onRetry={() => void query.fetchNextPage()}
        />
      ) : null}
    </section>
  );
}
