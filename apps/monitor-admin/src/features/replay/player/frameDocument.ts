import playerScript from 'rrweb-player/dist/index.js?raw'
import playerStyles from 'rrweb-player/dist/style.css?raw'
import runtimeScript from './frameRuntime.js?raw'

// data: 文档天然是独立的不透明源；不要改成 srcDoc 或 blob:（它们会继承管理端源）。
// allow-same-origin 让 rrweb 访问内部 about:blank，但仍不能访问管理端。
// nonce 只交给我们自己的两个脚本；录制内容中的脚本和事件属性不能执行。
export function createFrameSource(): string {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline' https: http:",
    'img-src data: blob: https: http:',
    'font-src data: https: http:',
    'media-src data: blob:',
    'frame-src about:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const script = (value: string) => value.replace(/<\/script/gi, '<\\/script')
  const html = `<!doctype html><html lang="zh-CN"><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <meta name="referrer" content="no-referrer">
    <style>${playerStyles}
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eef1f5}
      .rr-player{border-radius:0;box-shadow:none;background:#eef1f5}
    </style></head><body><div id="player"></div>
    <script nonce="${nonce}">${script(playerScript)}</script>
    <script nonce="${nonce}">${script(runtimeScript)}</script>
    </body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
