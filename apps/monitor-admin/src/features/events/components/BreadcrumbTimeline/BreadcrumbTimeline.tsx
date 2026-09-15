import { Badge, Group, Paper, Text, Title } from '@mantine/core'
import type { Breadcrumb } from '@/features/events/model/eventTypes'
import { formatTime } from '@/shared/lib/dateFormat'
import styles from './BreadcrumbTimeline.module.css'

export function BreadcrumbTimeline({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  return (
    <Paper component="section" className={styles.card} radius="md">
      <header>
        <Group gap="xs">
          <Title order={2}>行为轨迹</Title>
          <Badge variant="light" color="gray" size="xs">
            {breadcrumbs.length} 条轨迹
          </Badge>
        </Group>
      </header>
      {breadcrumbs.length === 0 ? (
        <Text className={styles.empty}>暂无行为轨迹</Text>
      ) : (
        <div className={styles.list}>
          {breadcrumbs.map((breadcrumb, index) => (
            <article key={`${breadcrumb.timestamp}-${index}`}>
              <span className={`${styles.dot} ${styles[breadcrumb.category]}`} />
              <time dateTime={new Date(breadcrumb.timestamp).toISOString()}>
                {formatTime(breadcrumb.timestamp, false)}
              </time>
              <Badge className={styles.category} variant="light" color="gray" size="xs">
                {breadcrumb.category}
              </Badge>
              <div className={styles.message}>
                <strong>{breadcrumb.message || '未提供描述'}</strong>
                {breadcrumb.data != null ? (
                  <details>
                    <summary>查看数据</summary>
                    <pre>
                      <code>{JSON.stringify(breadcrumb.data, null, 2)}</code>
                    </pre>
                  </details>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </Paper>
  )
}
