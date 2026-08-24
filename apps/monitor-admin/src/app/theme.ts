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

const sansFontFamily =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif'

export const monitorTheme = createTheme({
  colors: { brand },
  primaryColor: 'brand',
  primaryShade: 6,
  defaultRadius: 'md',
  fontFamily: sansFontFamily,
  fontFamilyMonospace: '"Cascadia Code", Consolas, monospace',
  headings: {
    fontFamily: sansFontFamily,
    fontWeight: '700',
  },
})
