import { useState } from 'react'
import { Button, Divider, Group, Popover, Stack, Text, TextInput } from '@mantine/core'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ChevronIcon } from '@/shared/ui/icons/Icons'
import {
  isValidTimeRange,
  localDateTime,
  parseLocalDateTime,
  presetTimeRange,
  timePresets,
  type TimeRange,
} from '../model/timeRange'
import styles from './TimeRangePicker.module.css'

const schema = z
  .object({
    from: z
      .string()
      .refine((value) => Number.isFinite(parseLocalDateTime(value)), '请选择开始时间'),
    to: z.string().refine((value) => Number.isFinite(parseLocalDateTime(value)), '请选择结束时间'),
  })
  .refine(
    (value) => isValidTimeRange(parseLocalDateTime(value.from), parseLocalDateTime(value.to)),
    {
      path: ['to'],
      message: '结束时间须晚于开始时间，且不晚于 2100 年',
    },
  )

interface Props {
  value: TimeRange | null
  onChange: (range: TimeRange) => void
}

export function TimeRangePicker({ value, onChange }: Props) {
  const [opened, setOpened] = useState(false)
  const label =
    timePresets.find((item) => item.value === value?.preset)?.label ||
    (value ? '自定义时间' : '选择时间')
  const interval = value
    ? `${localDateTime(value.from).replace('T', ' ')} — ${localDateTime(value.to).replace('T', ' ')}`
    : ''
  const displayLabel =
    value?.preset === 'custom'
      ? `${localDateTime(value.from).slice(5, 16).replace('T', ' ')} — ${localDateTime(value.to).slice(5, 16).replace('T', ' ')}`
      : label
  function apply(range: TimeRange) {
    onChange(range)
    setOpened(false)
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={410}
      shadow="md"
      withArrow
    >
      <Popover.Target>
        <Button
          className={styles.trigger}
          variant="default"
          onClick={() => setOpened(!opened)}
          rightSection={<ChevronIcon />}
          aria-label={`时间范围：${label}`}
          title={interval}
        >
          {displayLabel}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className={styles.dropdown}>
        <Stack gap="md">
          <Text fw={600} size="sm">
            时间范围
          </Text>
          <Group gap="xs" grow>
            {timePresets.map((preset) => (
              <Button
                key={preset.value}
                size="compact-sm"
                variant={value?.preset === preset.value ? 'light' : 'default'}
                onClick={() => apply(presetTimeRange(preset.value))}
              >
                {preset.label}
              </Button>
            ))}
          </Group>
          <Divider />
          {opened ? <CustomRangeForm value={value} onChange={apply} /> : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

function CustomRangeForm({ value, onChange }: Props) {
  const initial = value || presetTimeRange('24h')
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { from: localDateTime(initial.from), to: localDateTime(initial.to) },
  })
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((fields) =>
        onChange({
          from: parseLocalDateTime(fields.from),
          to: parseLocalDateTime(fields.to),
          preset: 'custom',
        }),
      )}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          自定义 · 本地时间
        </Text>
        <TextInput
          label="开始时间"
          type="datetime-local"
          step={1}
          {...form.register('from', { deps: ['to'] })}
          error={form.formState.errors.from?.message}
        />
        <TextInput
          label="结束时间"
          type="datetime-local"
          step={1}
          {...form.register('to')}
          error={form.formState.errors.to?.message}
        />
        <Button type="submit" mt={4}>
          应用时间范围
        </Button>
      </Stack>
    </form>
  )
}
