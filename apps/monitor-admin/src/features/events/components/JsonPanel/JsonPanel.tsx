import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon } from '@/shared/ui/icons/Icons'
import styles from './JsonPanel.module.css'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeout.current), [])

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.clearTimeout(timeout.current)
    timeout.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return <button className={styles.copyButton} type="button" onClick={() => void copy()}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? '已复制' : '复制'}</button>
}

export function JsonPanel({ title, value }: { title: string; value: unknown }) {
  const formatted = JSON.stringify(value, null, 2)
  return <section className={styles.card}><header><h2>{title}</h2><CopyButton value={formatted} /></header><pre><code>{formatted}</code></pre></section>
}
