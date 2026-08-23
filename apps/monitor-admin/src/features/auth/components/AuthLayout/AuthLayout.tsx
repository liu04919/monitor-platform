import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PulseIcon } from '@/shared/ui/icons/Icons'
import styles from './AuthLayout.module.css'

interface AuthLayoutProps {
  title: string
  footer: ReactNode
  children: ReactNode
}

export function AuthLayout({ title, footer, children }: AuthLayoutProps) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link className={styles.brand} to="/login" aria-label="Monitor 管理端">
          <span><PulseIcon /></span>
          <strong>Monitor</strong>
        </Link>
        <div className={styles.heading}>
          <h1>{title}</h1>
        </div>
        {children}
        <div className={styles.footer}>{footer}</div>
      </section>
    </main>
  )
}
