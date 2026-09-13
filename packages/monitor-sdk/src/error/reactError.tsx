import React, { ReactNode } from 'react'
import { getReactComponentInfo } from '../common/utils'
import type { ExceptionErrorEvent, MonitorContext, MonitorPlugin } from '../types'
import { createErrorBase, normalizeException } from './shared'

interface FallbackProps {
  error: ExceptionErrorEvent | null
}

interface ErrorBoundaryProps {
  Fallback: React.ComponentType<FallbackProps>
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: ExceptionErrorEvent | null
}

function createErrorBoundary(ctx: MonitorContext) {
  return class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
      hasError: false,
      error: null,
    }

    static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
      return {
        hasError: true,
      }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
      const { componentName, url } = getReactComponentInfo(errorInfo)

      const reportData: ExceptionErrorEvent = {
        ...createErrorBase(ctx),
        eventType: 'react_error',
        payload: {
          exception: normalizeException(error),
          mechanism: {
            type: 'react.error_boundary',
            // 错误边界已接管渲染并显示 Fallback。
            handled: true,
          },
          component: {
            name: componentName,
            file: url || undefined,
            stack: errorInfo.componentStack || undefined,
          },
        },
      }

      this.setState({
        error: reportData,
      })

      ctx.report(reportData)
    }

    render(): ReactNode {
      const { Fallback, children } = this.props
      const { hasError, error } = this.state

      if (hasError) {
        return <Fallback error={error} />
      }

      return children
    }
  }
}

export const reactErrorPlugin = (): MonitorPlugin => ({
  name: 'error:react',
  setup(ctx) {
    // 每个 Monitor 安装时只创建一次组件类型，不在业务组件渲染中重新创建。
    ctx.provide('error:react-boundary', createErrorBoundary(ctx))
  },
})
