import { createTheme, type MantineColorsTuple } from '@mantine/core'

const brand: MantineColorsTuple = [
  '#edf4ff',
  '#dce8fc',
  '#b8cff8',
  '#8db2f4',
  '#6999ef',
  '#4c86ec',
  '#2767e7',
  '#1e57cf',
  '#1749b8',
  '#0e3b9f',
]

export const monitorTheme = createTheme({
  colors: { brand },
  primaryColor: 'brand',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  fontFamilyMonospace: '"Cascadia Code", Consolas, monospace',
  headings: {
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    fontWeight: '700',
  },
})
