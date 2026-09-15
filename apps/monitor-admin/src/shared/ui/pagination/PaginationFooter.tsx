import { useState } from 'react'
import { Button, NumberInput, Pagination, Select, Stack, Text } from '@mantine/core'
import { maxPage, type PageInfo, type PaginationParams } from '@/shared/lib/pagination'
import styles from './PaginationFooter.module.css'

interface PaginationFooterProps {
  info: PageInfo
  disabled?: boolean
  onChange: (next: PaginationParams) => void
}

export function PaginationFooter({ info, disabled = false, onChange }: PaginationFooterProps) {
  const { page, pageSize, total } = info
  const totalPages = Math.ceil(total / pageSize)
  const start = total === 0 || page > totalPages ? 0 : (page - 1) * pageSize + 1
  const end = start === 0 ? 0 : Math.min(page * pageSize, total)
  const sizes = [...new Set([10, 30, 50, 100, pageSize])].sort((a, b) => a - b)

  return (
    <footer className={styles.footer} aria-label="列表分页">
      <Text size="sm" c="dimmed">
        共 {total.toLocaleString('zh-CN')} 条{start > 0 ? ` · 第 ${start}–${end} 条` : ''}
      </Text>
      <div className={styles.controls}>
        <Select
          aria-label="每页条数"
          className={styles.pageSize}
          size="xs"
          value={String(pageSize)}
          data={sizes.map((size) => ({ value: String(size), label: `${size} 条/页` }))}
          allowDeselect={false}
          disabled={disabled}
          onChange={(value) => value && onChange({ page: 1, pageSize: Number(value) })}
        />
        <Pagination
          total={Math.min(totalPages, maxPage)}
          value={page}
          size="sm"
          siblings={1}
          withEdges
          disabled={disabled || total === 0}
          onChange={(next) => onChange({ page: next, pageSize })}
          getItemProps={(number) => ({ 'aria-label': `第 ${number} 页` })}
          getControlProps={(control) => ({
            'aria-label': { first: '第一页', last: '最后一页', previous: '上一页', next: '下一页' }[
              control
            ],
          })}
        />
        <PageJump
          key={`${page}:${pageSize}`}
          page={page}
          totalPages={Math.min(totalPages, maxPage)}
          disabled={disabled || total === 0}
          onJump={(next) => onChange({ page: next, pageSize })}
        />
      </div>
    </footer>
  )
}

function PageJump({
  page,
  totalPages,
  disabled,
  onJump,
}: {
  page: number
  totalPages: number
  disabled: boolean
  onJump: (page: number) => void
}) {
  const [value, setValue] = useState<string | number>(page)
  const valid =
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= totalPages
  return (
    <form
      className={styles.jump}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && !disabled) onJump(value)
      }}
    >
      <Text size="sm" c="dimmed">
        跳至
      </Text>
      <NumberInput
        aria-label="跳转页码"
        size="xs"
        className={styles.pageInput}
        value={value}
        onChange={setValue}
        min={1}
        max={Math.max(1, totalPages)}
        allowDecimal={false}
        allowNegative={false}
        hideControls
        disabled={disabled}
      />
      <Button type="submit" variant="default" size="compact-xs" disabled={disabled || !valid}>
        跳转
      </Button>
    </form>
  )
}

export function EmptyPage({ onFirstPage }: { onFirstPage: () => void }) {
  return (
    <Stack align="center" justify="center" mih={240} gap="sm">
      <Text c="dimmed">当前页暂无数据</Text>
      <Button variant="default" size="xs" onClick={onFirstPage}>
        返回第一页
      </Button>
    </Stack>
  )
}
