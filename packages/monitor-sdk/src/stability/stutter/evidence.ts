import type { TimingSample } from './types'

const MAX_SAMPLES = 100
const MAX_AGE_MS = 10_000

// 只保留两个数字，不缓存原生 PerformanceEntry 或 DOM 引用。
export function rememberSample(samples: TimingSample[], sample: TimingSample, now: number): void {
  samples.push({ startTime: sample.startTime, duration: sample.duration })
  pruneSamples(samples, now)
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
}

function pruneSamples(samples: TimingSample[], now: number): void {
  // Observer 回调可能乱序，不能假定数组前端一定是最早发生的样本。
  for (let index = samples.length - 1; index >= 0; index--) {
    if (samples[index].startTime + samples[index].duration < now - MAX_AGE_MS) {
      samples.splice(index, 1)
    }
  }
}

export function matchingSamples(
  samples: TimingSample[],
  frame: TimingSample,
  now: number,
): TimingSample[] {
  pruneSamples(samples, now)
  const end = frame.startTime + frame.duration
  return samples.filter(
    (sample) => sample.startTime < end && sample.startTime + sample.duration > frame.startTime,
  )
}
