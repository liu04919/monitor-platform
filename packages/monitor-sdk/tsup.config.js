import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/plugins/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,

  // 新增
  metafile: true,
  minify: true,
  platform: 'browser',
  target: 'es2020',
})
