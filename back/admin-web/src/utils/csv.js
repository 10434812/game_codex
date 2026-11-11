/**
 * Minimal CSV export helper (client-side, no backend dependency).
 * Usage: downloadCsv('users.csv', ['ID', '昵称'], rows.map(r => [r.uid, r.nickname]))
 */
function escapeCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  // 防公式注入：以 = + - @ 开头（含前导空白/制表符后的情况）的单元格前置单引号（M-7）
  if (/^[\s\t]*[=+\-@]/.test(text)) {
    text = "'" + text
  }
  if (/[",\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return text
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') // BOM so Excel opens UTF-8 correctly
}

function downloadCsv(filename, headers, rows) {
  const csv = toCsv(headers, rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export { escapeCell, toCsv, downloadCsv }
