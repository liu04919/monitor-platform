import { Badge } from '@mantine/core'
import styles from './ExceptionPanel.module.css'

interface ExceptionPanelProps {
  payload: Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function ExceptionPanel({ payload }: ExceptionPanelProps) {
  const exception = isObject(payload.exception) ? payload.exception : null
  const frames = Array.isArray(exception?.stack) ? exception.stack.filter(isObject) : []
  const name = typeof exception?.name === 'string' ? exception.name : ''

  return (
    <section className={styles.panel} aria-labelledby="exception-title">
      <header>
        <h2 id="exception-title">错误堆栈</h2>
        {name ? (
          <Badge variant="light" color="red">
            {name}
          </Badge>
        ) : null}
      </header>
      {frames.length ? (
        <ol className={styles.frames}>
          {frames.map((frame, index) => {
            const filename = typeof frame.filename === 'string' ? frame.filename : '未知文件'
            const functionName =
              typeof frame.functionName === 'string' ? frame.functionName : '匿名函数'
            const line = typeof frame.line === 'number' ? `:${frame.line}` : ''
            const column = typeof frame.column === 'number' ? `:${frame.column}` : ''
            return (
              <li key={index}>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <code className={styles.functionName}>{functionName}</code>
                  <code className={styles.location} title={`${filename}${line}${column}`}>
                    {filename}
                    {line}
                    {column}
                  </code>
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className={styles.empty}>未记录错误堆栈</p>
      )}
    </section>
  )
}
