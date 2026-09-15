import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

// 命令都是脚本内的固定值；通过系统 shell 兼容 Windows 的 pnpm.cmd。
function run(command) {
  console.log(`\n[prepare] ${command}`)
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
  })
  if (result.error || result.status !== 0) {
    throw new Error(`启动准备失败：${command}`)
  }
}

function createLocalConfig(example, target) {
  try {
    // 文件存在时不覆盖，保留本地数据库凭据和 Demo 项目配置。
    copyFileSync(resolve(root, example), resolve(root, target), constants.COPYFILE_EXCL)
    console.log(`[prepare] 已创建 ${target}`)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

try {
  const docker = spawnSync('docker info', {
    cwd: root,
    shell: true,
    stdio: 'ignore',
    timeout: 15_000,
  })
  if (docker.error || docker.status !== 0) {
    throw new Error('无法连接 Docker。请先启动 Docker Desktop，等待 Engine 就绪后重试。')
  }

  createLocalConfig('.env.example', '.env')
  createLocalConfig('apps/monitor-demo/.env.example', 'apps/monitor-demo/.env.local')

  // 子项目保持各自的 lockfile；首次启动缺少依赖时才安装。
  for (const directory of ['packages/monitor-sdk', 'apps/monitor-admin', 'apps/monitor-demo']) {
    if (!existsSync(resolve(root, directory, 'node_modules/.modules.yaml'))) {
      run(`pnpm --dir ${directory} install --frozen-lockfile`)
    }
  }

  run('docker compose -f compose.yaml up -d --wait --wait-timeout 120 postgres clickhouse redis')
  // 迁移程序按版本跳过已执行的 SQL，不重建表、不清空数据。
  run('go -C apps/server run ./cmd/migrate')
  // Demo 通过 link 引用 SDK 的 dist，每次启动先构建最新源码。
  run('pnpm --dir packages/monitor-sdk build')

  console.log('\n[dev] 即将启动：后端 :8080 · 管理端 :5174 · Demo :5173（默认端口）')
  console.log('[dev] Demo 上报前请在 apps/monitor-demo/.env.local 填写自己的项目配置。')
  console.log('[dev] Ctrl+C 停止三个应用；Docker 数据库继续运行，数据保留。\n')
} catch (error) {
  console.error(`\n[dev] ${error.message}`)
  process.exitCode = 1
}
