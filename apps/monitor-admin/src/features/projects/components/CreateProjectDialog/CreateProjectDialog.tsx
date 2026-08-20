import { useState, type FormEvent } from 'react'
import type { CreateProjectInput, CreatedProject } from '@/features/projects/model/projectTypes'
import styles from './CreateProjectDialog.module.css'

interface CreateProjectDialogProps {
  isPending: boolean
  errorMessage: string
  createdProject: CreatedProject | null
  onSubmit: (input: CreateProjectInput) => void
  onClose: () => void
}

export function CreateProjectDialog({
  isPending,
  errorMessage,
  createdProject,
  onSubmit,
  onClose,
}: CreateProjectDialogProps) {
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const sdkConfig = createdProject ? buildSDKConfig(createdProject) : ''

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({ id: projectId.trim(), name: projectName.trim() })
  }

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(sdkConfig)
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败，请手动选择')
    }
  }

  return (
    <div className={styles.backdrop}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        {createdProject ? (
          <>
            <div className={styles.heading}>
              <div><p>PROJECT READY</p><h2 id="create-project-title">项目已创建</h2></div>
              <button className={styles.closeButton} type="button" onClick={onClose} aria-label="关闭">×</button>
            </div>
            <p className={styles.description}>项目已自动切换。把下面配置放进浏览器 SDK 初始化代码即可开始上报。</p>
            <div className={styles.configHeader}><strong>SDK 配置</strong><button type="button" onClick={() => void copyConfig()}>复制配置</button></div>
            <pre className={styles.config}><code>{sdkConfig}</code></pre>
            <p className={styles.copyStatus} aria-live="polite">{copyStatus}</p>
            <p className={styles.boundary}>publicKey 会出现在浏览器中，只能用于事件上报，不能读取管理数据。</p>
            <button className={styles.primaryButton} type="button" onClick={onClose}>完成</button>
          </>
        ) : (
          <>
            <div className={styles.heading}>
              <div><p>NEW PROJECT</p><h2 id="create-project-title">创建项目</h2></div>
              <button className={styles.closeButton} type="button" onClick={onClose} aria-label="关闭" disabled={isPending}>×</button>
            </div>
            <p className={styles.description}>项目 ID 会成为 SDK 的 appId，创建后不可修改。</p>
            <form onSubmit={submit}>
              <div className={styles.field}>
                <label htmlFor="project-name">项目名称</label>
                <input
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  maxLength={128}
                  placeholder="例如 Monitor Web"
                  autoFocus
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="project-id">项目 ID</label>
                <input
                  id="project-id"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  maxLength={128}
                  pattern="[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?"
                  placeholder="例如 monitor-web"
                  aria-describedby="project-id-help"
                  required
                />
                <small id="project-id-help">仅小写字母、数字和中间连字符。</small>
              </div>
              {errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : null}
              <div className={styles.actions}>
                <button type="button" onClick={onClose} disabled={isPending}>取消</button>
                <button className={styles.primaryButton} type="submit" disabled={isPending}>{isPending ? '正在创建…' : '创建项目'}</button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function buildSDKConfig(project: CreatedProject) {
  return `createMonitor({
  url: 'http://127.0.0.1:8080/api/v1/events/batch',
  projectName: '${escapeJavaScriptString(project.name)}',
  appId: '${escapeJavaScriptString(project.id)}',
  publicKey: '${escapeJavaScriptString(project.publicKey)}',
})`
}

function escapeJavaScriptString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
