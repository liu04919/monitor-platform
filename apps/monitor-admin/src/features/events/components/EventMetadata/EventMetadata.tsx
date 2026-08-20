import { Badge, Paper, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import type { EventDetail } from '@/features/events/model/eventTypes'
import { formatFullTime } from '@/shared/lib/dateFormat'
import styles from './EventMetadata.module.css'

function MetadataItem({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className={styles.item}><dt>{label}</dt><dd className={mono ? styles.mono : undefined}>{children || '—'}</dd></div>
}

export function EventMetadata({ event }: { event: EventDetail }) {
  return (
    <Paper component="section" className={styles.card} radius="md">
      <header><Title order={2}>事件信息</Title><Badge variant="light" color="gray" size="sm">Schema v{event.schemaVersion}</Badge></header>
      <dl className={styles.grid}>
        <MetadataItem label="事件 ID" mono>{event.eventId}</MetadataItem>
        <MetadataItem label="发生时间">{formatFullTime(event.timestamp)}</MetadataItem>
        <MetadataItem label="项目">{event.projectId}</MetadataItem>
        <MetadataItem label="应用">{event.appName}</MetadataItem>
        <MetadataItem label="批次 ID" mono>{event.batchId}</MetadataItem>
        <MetadataItem label="发送时间">{formatFullTime(event.sentAt)}</MetadataItem>
        <MetadataItem label="用户">{event.userId || '匿名'}</MetadataItem>
        <MetadataItem label="传输方式"><Badge color={event.sendType === 'beacon' ? 'violet' : 'gray'} variant="light" size="xs">{event.sendType}</Badge></MetadataItem>
        <MetadataItem label="服务端接收">{formatFullTime(event.receivedAt)}</MetadataItem>
      </dl>
    </Paper>
  )
}

export function EventContext({ event }: { event: EventDetail }) {
  return (
    <Paper component="section" className={styles.contextCard} radius="md">
      <header><Title order={2}>原始上下文</Title></header>
      <dl>
        <MetadataItem label="Category" mono>{event.category}</MetadataItem>
        <MetadataItem label="Event type" mono>{event.eventType}</MetadataItem>
        <MetadataItem label="Page URL">{event.pageUrl || '—'}</MetadataItem>
        <MetadataItem label="Level" mono>{event.level || '—'}</MetadataItem>
      </dl>
    </Paper>
  )
}
