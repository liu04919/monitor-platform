import {
  Badge,
  Button,
  Input,
  InputWrapper,
  Modal,
  createTheme,
  type MantineColorsTuple,
} from '@mantine/core'

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
  defaultRadius: 'sm',
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  fontSizes: { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem', xl: '1.125rem' },
  headings: {
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
  },
  components: {
    Button: Button.extend({ styles: { root: { fontWeight: 600 } } }),
    Badge: Badge.extend({
      styles: { root: { textTransform: 'none', letterSpacing: 0, fontWeight: 500 } },
    }),
    Input: Input.extend({ styles: { input: { fontSize: 14 } } }),
    InputWrapper: InputWrapper.extend({
      styles: { label: { fontSize: 13, fontWeight: 500, marginBottom: 6 } },
    }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'md',
        padding: 'lg',
        overlayProps: { backgroundOpacity: 0.35, blur: 2 },
      },
      styles: { title: { fontSize: 20, fontWeight: 600 }, body: { overscrollBehavior: 'contain' } },
    }),
  },
})
