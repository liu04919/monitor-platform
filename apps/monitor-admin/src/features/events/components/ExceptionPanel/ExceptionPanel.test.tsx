import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { monitorTheme } from '@/app/theme'
import { ExceptionPanel } from './ExceptionPanel'

function renderPayload(payload: Record<string, unknown>) {
  return render(
    <MantineProvider theme={monitorTheme} env="test">
      <ExceptionPanel payload={payload} />
    </MantineProvider>,
  )
}

describe('ExceptionPanel', () => {
  it('按 SDK 栈帧顺序显示函数、文件和行列号', () => {
    renderPayload({
      exception: {
        name: 'TypeError',
        stack: [
          { functionName: 'renderProfile', filename: '/profile.js', line: 128, column: 19 },
          { functionName: 'handleSubmit', filename: '/app.js', line: 24 },
        ],
      },
    })

    expect(screen.getByText('TypeError')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('renderProfile/profile.js:128:19')
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('handleSubmit/app.js:24')
  })

  it('没有结构化堆栈时显示空状态', () => {
    renderPayload({ message: 'SCRIPT load error', resource: { src: '/missing.js' } })
    expect(screen.getByText('未记录错误堆栈')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('忽略无效栈帧，缺少可选字段时也能正常显示', () => {
    renderPayload({ exception: { stack: [null, 'invalid', [], { filename: '/chunk.js' }] } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('匿名函数')).toBeInTheDocument()
    expect(screen.getByText('/chunk.js')).toBeInTheDocument()
  })
})
