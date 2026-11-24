<template>
  <div class="dashboard-page">
    <header class="dashboard-heading">
      <div>
        <h1>玩法运营看板</h1>
        <p>查看开局、房间状态和玩家复玩情况。</p>
      </div>
      <div class="refresh-tools">
        <span v-if="updatedAt" class="muted" role="status">
          {{ failedSections.length ? '部分更新于' : '更新于' }} {{ updatedAt }}
        </span>
        <el-button :icon="Refresh" :loading="loading" @click="refresh">刷新数据</el-button>
      </div>
    </header>

    <el-alert
      v-if="failedSections.length"
      :title="`${failedSections.join('、')}加载失败，请刷新重试。`"
      type="warning"
      :closable="false"
      show-icon
    />

    <section aria-label="运营概览" class="metric-strip">
      <dl v-for="metric in metrics" :key="metric.label" class="metric">
        <dt>{{ metric.label }}</dt>
        <dd class="metric-value">{{ count(metric.value) }}</dd>
        <dd class="muted">{{ metric.detail }}</dd>
      </dl>
    </section>

    <div class="dashboard-grid">
      <section class="dashboard-panel" aria-labelledby="match-heading" :aria-busy="loading">
        <div class="panel-heading">
          <h2 id="match-heading">快速匹配</h2>
          <span class="muted">{{ analyticsPeriod }}</span>
        </div>
        <div v-if="matchmaking.length" class="matchmaking-clients">
          <div v-for="row in matchmaking" :key="row.client" class="matchmaking-client">
            <h3>{{ clientNames[row.client] || '其他客户端' }}</h3>
            <dl class="matchmaking-metrics">
              <div>
                <dt>匹配开局率</dt>
                <dd>{{ rate(row.started, row.requests) }}</dd>
                <dd class="muted">{{ count(row.started) }} 开局 / {{ count(row.requests) }} 请求</dd>
              </div>
              <div>
                <dt>平均排队</dt>
                <dd>{{ seconds(row.averageWaitMs) }}</dd>
                <dd class="muted">已开局且有耗时上报</dd>
              </div>
              <div>
                <dt>机器人席位占比</dt>
                <dd>{{ rate(row.botPlayers, row.totalPlayers) }}</dd>
                <dd class="muted">全真人开局 {{ count(row.allHumanStarts) }} 次</dd>
              </div>
            </dl>
            <p class="matchmaking-outcomes muted">
              <span>请求失败 {{ count(row.failed) }}</span>
              <span>取消或失效 {{ count(row.cancelled) }}</span>
              <span>曾切后台 {{ count(row.background) }}</span>
            </p>
          </div>
        </div>
        <p v-else class="panel-status">{{ analyticsMessages.noMatches }}</p>
      </section>

      <section class="dashboard-panel" aria-labelledby="replay-heading" :aria-busy="loading">
        <div class="panel-heading">
          <h2 id="replay-heading">完局与复玩</h2>
          <span class="muted">{{ analyticsPeriod }}</span>
        </div>
        <dl v-if="data.analytics" class="conversion-list">
          <div v-for="metric in conversion" :key="metric.label">
            <dt>{{ metric.label }}</dt>
            <dd>{{ rate(metric.part, metric.total) }}</dd>
            <dd class="muted">{{ metric.detail }}</dd>
          </div>
        </dl>
        <p v-else class="panel-status">{{ analyticsMessages.unavailable }}</p>
        <router-link class="dashboard-link panel-link" :to="{ name: 'StatsOverview' }">
          查看留存和匹配详情 <el-icon><ArrowRight /></el-icon>
        </router-link>
      </section>

      <section class="dashboard-panel" aria-labelledby="trend-heading" :aria-busy="loading">
        <div class="panel-heading">
          <h2 id="trend-heading">近 7 日开局趋势</h2>
          <router-link class="dashboard-link" :to="{ name: 'StatsOverview' }">
            数据统计 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <p v-if="!hasTrend" class="panel-status">{{ trendMessage }}</p>
        <v-chart v-else class="trend-chart" :option="trendOption" autoresize />
      </section>

      <nav class="dashboard-panel" aria-label="运营入口">
        <div class="panel-heading">
          <h2>运营入口</h2>
        </div>
        <router-link v-for="link in links" :key="link.route" class="operation-link" :to="{ name: link.route }">
          <span>{{ link.label }}<small>{{ link.detail }}</small></span>
          <el-icon><ArrowRight /></el-icon>
        </router-link>
      </nav>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowRight, Refresh } from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import request from '@/utils/request'

use([CanvasRenderer, LineChart, BarChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent])

const sources = [
  { key: 'dashboard', label: '今日概览', url: '/api/admin/dashboard' },
  { key: 'rooms', label: '房间统计', url: '/api/admin/rooms/stats' },
  { key: 'trend', label: '开局趋势', url: '/api/admin/stats/overview', params: { limit: 7 } },
  { key: 'analytics', label: '玩法埋点', url: '/api/admin/stats/analytics' }
]
const links = [
  { route: 'RoomList', label: '房间管理', detail: '查看等待和进行中的房间' },
  { route: 'GameList', label: '对局监控', detail: '查看场次、景区和结算记录' },
  { route: 'UserList', label: '玩家管理', detail: '查看玩家战绩与金币流水' },
  { route: 'SystemConfig', label: '系统配置', detail: '管理对局和微信接入配置' }
]
const clientNames = { miniprogram: '小程序', minigame: '小游戏' }
const numberFormat = new Intl.NumberFormat('zh-CN')
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })
const data = reactive({})
const loading = ref(true)
const failures = ref([])
const updatedAt = ref('')
const failedSections = computed(() => sources.filter(({ key }) => failures.value.includes(key)).map(({ label }) => label))

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function count(value) {
  const result = number(value)
  return result === null ? '—' : numberFormat.format(result)
}

function rate(value, total) {
  const numerator = number(value)
  return numerator !== null && Number(total) > 0 ? `${(100 * numerator / Number(total)).toFixed(1)}%` : '—'
}

function seconds(value) {
  const result = number(value)
  return result === null ? '—' : `${(result / 1000).toFixed(1)} 秒`
}

function sourceStatus(key) {
  return failures.value.includes(key) ? '暂不可用' : loading.value ? '加载中…' : ''
}

const metrics = computed(() => {
  const daily = data.trend?.dau || []
  const latestDau = daily[daily.length - 1]?.count
  return [
    { label: '今日开局', value: data.dashboard?.todayGames, detail: sourceStatus('dashboard') || '服务端记录' },
    {
      label: '进行中房间',
      value: data.rooms?.playing ?? data.dashboard?.activeRooms,
      detail: data.rooms ? `${count(data.rooms.waiting)} 间等待中` : sourceStatus('rooms') || '当前服务端状态'
    },
    { label: '今日参赛账号', value: latestDau, detail: sourceStatus('trend') || '按参与对局的账号去重' },
    { label: '今日金币入账', value: data.dashboard?.todayRevenue, detail: sourceStatus('dashboard') || '虚拟金币 · 正向流水' }
  ]
})
const analyticsPeriod = computed(() => sourceStatus('analytics') || '近 7 天 · 客户端上报')
const matchmaking = computed(() => data.analytics?.matchmaking || [])
const analyticsMessages = computed(() => ({
  noMatches: sourceStatus('analytics') || '近 7 天暂无快速匹配上报。',
  unavailable: sourceStatus('analytics') || '暂无完局与复玩记录。'
}))
const conversion = computed(() => {
  const completion = data.analytics?.completion
  const replay = data.analytics?.replay
  return [
    {
      label: '客户端完局率',
      part: completion?.finishes,
      total: completion?.starts,
      detail: Number(completion?.starts) > 0
        ? `${count(completion.finishes)} 次查看结算 / ${count(completion.starts)} 次玩家开局`
        : '暂无可关联的开局样本'
    },
    {
      label: '复玩开局率',
      part: replay?.started,
      total: replay?.attempts,
      detail: Number(replay?.attempts) > 0
        ? `${count(replay.started)} 次复玩开局 / ${count(replay.attempts)} 次复玩请求`
        : '暂无可关联的复玩请求'
    }
  ]
})

const hasTrend = computed(() => data.trend?.games?.length > 0)
const trendMessage = computed(() => sourceStatus('trend') || '暂无开局趋势。')
const trendOption = computed(() => {
  const days = data.trend?.games || []
  const participants = new Map((data.trend?.dau || []).map(({ date, count }) => [date, number(count)]))
  return {
    aria: { enabled: true },
    color: ['#ac5721', '#297361'],
    tooltip: { trigger: 'axis', confine: true },
    legend: { bottom: 0, textStyle: { color: '#684d3c' } },
    grid: { top: 16, bottom: 42, left: 10, right: 16, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.map(({ date }) => date),
      axisLabel: { formatter: (date) => date.slice(5), color: '#684d3c' }
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#684d3c' } },
    series: [
      { type: 'bar', name: '开局场次', data: days.map(({ count }) => number(count)), barMaxWidth: 22 },
      { type: 'line', name: '参赛账号', data: days.map(({ date }) => participants.get(date) ?? null), symbolSize: 6 }
    ]
  }
})

async function refresh() {
  loading.value = true
  failures.value = []
  const results = await Promise.allSettled(sources.map(async ({ url, params }) => {
    const response = await request.get(url, { params })
    if (response.data?.code !== 0 || !response.data.data) throw new Error('请求失败')
    return response.data.data
  }))
  results.forEach((result, index) => {
    const { key } = sources[index]
    if (result.status === 'fulfilled') {
      data[key] = result.value
    } else {
      delete data[key]
      failures.value.push(key)
    }
  })
  updatedAt.value = results.some(({ status }) => status === 'fulfilled') ? timeFormat.format(new Date()) : ''
  loading.value = false
}

onMounted(refresh)
</script>

<style scoped>
.dashboard-page {
  --dashboard-border: #e8d9c6;
  --dashboard-text-muted: #684d3c;
  --dashboard-link: #91461c;
  display: grid;
  gap: 18px;
  font-variant-numeric: tabular-nums;
}

.dashboard-heading,
.refresh-tools,
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.dashboard-heading h1 { margin: 0; font-size: 28px; line-height: 1.25; }
.dashboard-heading p { margin: 6px 0 0; color: var(--dashboard-text-muted); }
.muted { color: var(--dashboard-text-muted); font-size: 13px; line-height: 1.55; }

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--dashboard-border);
  border-radius: 12px;
  background: #fff5e6;
}

.metric { min-width: 0; margin: 0; padding: 16px 20px; }
.metric + .metric { border-inline-start: 1px solid var(--dashboard-border); }
.metric dt, .matchmaking-metrics dt, .conversion-list dt { font-size: 14px; font-weight: 600; }
.metric dd, .matchmaking-metrics dd, .conversion-list dd { margin: 0; }
.metric dd.metric-value { margin: 4px 0; font-size: 29px; font-weight: 750; line-height: 1.2; overflow-wrap: anywhere; }

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 16px;
}

.dashboard-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px 20px;
  border: 1px solid var(--dashboard-border);
  border-radius: 12px;
  background: #fffdf7;
}

.panel-heading { border-bottom: 1px solid var(--dashboard-border); padding-bottom: 11px; }
.panel-heading h2 { margin: 0; font-size: 18px; line-height: 1.4; }
.matchmaking-client { padding: 14px 0 2px; }
.matchmaking-client + .matchmaking-client { border-top: 1px solid var(--dashboard-border); margin-top: 12px; }
.matchmaking-client h3 { margin: 0 0 10px; font-size: 14px; }
.matchmaking-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 16px; margin: 0; }
.matchmaking-metrics dd:nth-child(2), .conversion-list dd:nth-child(2) { margin: 3px 0 1px; font-size: 23px; font-weight: 750; }
.matchmaking-outcomes { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 12px 0 0; }
.conversion-list { margin: 0; }
.conversion-list > div { padding: 11px 0; border-bottom: 1px solid var(--dashboard-border); }
.panel-status { margin: 20px 0; color: var(--dashboard-text-muted); line-height: 1.55; }
.trend-chart { height: 220px; margin-top: 12px; }

.dashboard-link, .operation-link {
  color: var(--dashboard-link);
  font-size: 14px;
  font-weight: 650;
  text-decoration: none;
}

.dashboard-link { display: inline-flex; align-items: center; gap: 4px; }
.panel-link { align-self: flex-start; margin-top: auto; padding-top: 12px; }
.operation-link { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; }
.operation-link + .operation-link { border-top: 1px solid var(--dashboard-border); }
.operation-link small { display: block; margin-top: 2px; color: var(--dashboard-text-muted); font-size: 13px; font-weight: 400; }
.dashboard-link:hover, .operation-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.dashboard-link:focus-visible, .operation-link:focus-visible { outline: 2px solid var(--dashboard-link); outline-offset: 3px; }

@media (max-width: 1120px) {
  .dashboard-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 620px) {
  .dashboard-heading h1 { font-size: 23px; }
  .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric, .dashboard-panel { padding: 12px; }
  .metric:nth-child(odd) { border-inline-start: 0; }
  .metric:nth-child(n + 3) { border-top: 1px solid var(--dashboard-border); }
  .matchmaking-metrics { gap: 8px; }
  .matchmaking-metrics dd:nth-child(2) { font-size: 19px; }
}
</style>
