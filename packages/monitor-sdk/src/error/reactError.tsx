import React, { ReactNode } from 'react'
import { createEventBase } from '../common/event'
import { getReactComponentInfo, parseStackFrames } from '../common/utils'
import type { ExceptionErrorEvent, MonitorContext } from '../types'

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

export default function createErrorBoundary(ctx: MonitorContext) {
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

      const replayData = ctx.getRecordScreenData()

      const reportData: ExceptionErrorEvent = {
        ...createEventBase(ctx),

        category: 'error',
        eventType: 'react_error',
        level: 'error',

        breadcrumbs: ctx.getBehaviorState(),
        replayData: replayData || undefined,

        payload: {
          exception: {
            name: error.name,
            message: error.message,
            stack: parseStackFrames(error),
          },

          mechanism: {
            type: 'react.error_boundary',

            /**
             * ErrorBoundary 已经接管了渲染并显示 Fallback，
             * 所以这里可以认为是 handled。
             */
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
