export const gameModes = [
  { value: 'quick', label: '快速匹配', type: 'warning' },
  { value: 'friends', label: '好友房', type: 'success' },
  { value: 'unknown', label: '来源未记录', type: 'info' }
]

export function gameMode(value) {
  return gameModes.find((mode) => mode.value === value) || gameModes[2]
}
