import fetch from './fetch'
import observerEntries from './observerEntries'
import observerLCP from './observerLCP'
import observerFCP from './observerFCP'
import observerLoad from './observerLoad'
import observerPaint from './observerPaint'
import xhr from './xhr'
import { MonitorPlugin } from '../types'

export const fetchPlugin = (): MonitorPlugin => ({
  name: 'performance:fetch',
  setup: fetch,
})

export const xhrPlugin = (): MonitorPlugin => ({
  name: 'performance:xhr',
  setup: xhr,
})

export const resourcePlugin = (): MonitorPlugin => ({
  name: 'performance:resource',
  setup: observerEntries,
})

export const lcpPlugin = (): MonitorPlugin => ({
  name: 'performance:lcp',
  setup: observerLCP,
})

export const fcpPlugin = (): MonitorPlugin => ({
  name: 'performance:fcp',
  setup: observerFCP,
})

export const loadPlugin = (): MonitorPlugin => ({
  name: 'performance:load',
  setup: observerLoad,
})

export const fpPlugin = (): MonitorPlugin => ({
  name: 'performance:fp',
  setup: observerPaint,
})

export const performancePlugins = (): MonitorPlugin[] => [
  fetchPlugin(),
  resourcePlugin(),
  lcpPlugin(),
  fcpPlugin(),
  loadPlugin(),
  fpPlugin(),
  xhrPlugin(),
]
