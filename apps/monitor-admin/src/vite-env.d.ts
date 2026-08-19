/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MONITOR_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
