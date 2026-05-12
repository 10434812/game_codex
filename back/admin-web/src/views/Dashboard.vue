<template>
  <div class="dashboard-page">
    <section class="page-hero dashboard-hero">
      <div class="hero-copy">
        <span class="hero-kicker">ADMIN DASHBOARD</span>
        <h1>今天先看三件事：活跃、对局、变现</h1>
        <p>把增长趋势、运营健康度和微信关键配置放在同一屏，方便运营和技术一起判断今天该处理什么。</p>
      </div>
      <div class="hero-actions">
        <div class="hero-meta">
          <span>最近同步</span>
          <strong>{{ lastUpdatedText }}</strong>
        </div>
        <el-button plain @click="router.push({ name: 'SystemConfig' })">查看系统配置</el-button>
        <el-button type="primary" :loading="loading" @click="fetchDashboard">刷新数据</el-button>
      </div>
    </section>

    <section class="stat-cards">
      <el-card
        v-for="stat in statCards"
        :key="stat.key"
        shadow="never"
        class="stat-card"
      >
        <div class="stat-card-content">
          <div class="stat-info">
            <div class="stat-label">{{ stat.label }}</div>
            <div class="stat-value">{{ stat.value }}</div>
            <div class="stat-note">{{ stat.note }}</div>
            <div class="stat-trend" :class="stat.trendClass">
              <span>{{ stat.trendLabel }}</span>
              <span class="trend-text">{{ stat.trendText }}</span>
            </div>
          </div>
          <div class="stat-icon-wrap" :class="stat.theme">
            <el-icon class="stat-icon"><component :is="stat.icon" /></el-icon>
          </div>
        </div>
      </el-card>
    </section>

    <section class="dashboard-grid top-grid">
      <el-card shadow="never" class="overview-card">
        <template #header>
          <div class="card-header">
            <span>近 7 日运营概览</span>
            <el-tag size="small" effect="plain">趋势判断</el-tag>
          </div>
        </template>
        <v-chart :option="overviewChartOption" style="height: 360px" autoresize />
      </el-card>

      <el-card shadow="never" class="ops-card">
        <template #header>
          <div class="card-header">
            <span>运营健康度</span>
            <el-tag size="small" :type="healthTagType">{{ healthSummary.tag }}</el-tag>
          </div>
        </template>

        <div class="health-score">
          <div class="score-ring" :class="healthSummary.levelClass">{{ healthSummary.score }}</div>
          <div>
            <div class="score-title">{{ healthSummary.title }}</div>
            <p class="score-note">{{ healthSummary.description }}</p>
          </div>
        </div>

        <div class="health-list">
          <div v-for="item in healthMetrics" :key="item.label" class="health-item">
            <div>
              <div class="health-label">{{ item.label }}</div>
              <div class="health-value">{{ item.value }}</div>
            </div>
            <el-tag size="small" effect="plain" :type="item.type">{{ item.status }}</el-tag>
          </div>
        </div>
      </el-card>
    </section>

    <section class="dashboard-grid middle-grid">
      <el-card shadow="never" class="panel-card">
        <template #header>
          <div class="card-header">
            <span>流量与对局节奏</span>
            <span class="muted-text">活跃用户、对局数、金币收入同屏对比</span>
          </div>
        </template>
        <div class="mini-metrics">
          <div v-for="item in intensityMetrics" :key="item.label" class="mini-metric">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.note }}</small>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <template #header>
          <div class="card-header">
            <span>微信能力就绪度</span>
            <span class="muted-text">登录 / 分享 / 支付配置检查</span>
          </div>
        </template>
        <div class="capability-list">
          <div v-for="item in capabilityCards" :key="item.title" class="capability-item">
            <div class="capability-head">
              <strong>{{ item.title }}</strong>
              <el-tag size="small" :type="item.type">{{ item.status }}</el-tag>
            </div>
            <p>{{ item.note }}</p>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="panel-card">
        <template #header>
          <div class="card-header">
            <span>快捷入口</span>
            <span class="muted-text">高频运营动作</span>
          </div>
        </template>
        <div class="quick-actions">
          <button
            v-for="action in quickActions"
            :key="action.label"
            type="button"
            class="quick-action-item"
            @click="router.push({ name: action.routeName })"
          >
            <div class="quick-action-icon" :class="action.theme">
              <el-icon><component :is="action.icon" /></el-icon>
            </div>
            <strong>{{ action.label }}</strong>
            <span>{{ action.note }}</span>
          </button>
        </div>
      </el-card>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  User,
  Monitor,
  Coin,
  TrendCharts,
  Bell,
  Tools,
  HomeFilled,
  ChatLineRound,
  DataAnalysis
} from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent
} from 'echarts/components'
import request from '@/utils/request'

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent])

const router = useRouter()
const loading = ref(false)
const lastUpdatedAt = ref(null)
const configLoadState = ref('idle')
const dashboardData = ref({
  totalUsers: 0,
  todayGames: 0,
  activeRooms: 0,
  todayRevenue: 0,
  dailyStats: [],
  dailyGames: [],
  dailyRevenue: []
})
const configs = ref([])
const fallbackConfigs = [
  { key: 'wechat.login_enabled', value: 'true' },
  { key: 'wechat.login_app_id', value: 'wx72a4b552a87b44cf' },
  { key: 'wechat.login_secret', value: '' },
  { key: 'wechat.login_agreement_url', value: 'https://xcx.ukb88.com/legal/user-agreement.html' },
  { key: 'wechat.login_privacy_url', value: 'https://xcx.ukb88.com/legal/privacy-policy.html' },
  { key: 'wechat.share_enabled', value: 'true' },
  { key: 'wechat.share_title', value: '锦鲤前程邀你一起组队闯世界' },
  { key: 'wechat.share_path', value: '/pages/home/index' },
  { key: 'wechat.share_image_url', value: 'https://xcx.ukb88.com/assets/bg/screen.png' },
  { key: 'wechat.share_timeline_title', value: '锦鲤前程开启好运局，来和我一起冲榜' },
  { key: 'wechat.pay_enabled', value: 'false' },
  { key: 'wechat.pay_mch_id', value: '' },
  { key: 'wechat.pay_api_v3_key', value: '' },
  { key: 'wechat.pay_notify_url', value: '' }
]

function formatNumber(value) {
  const number = Number(value || 0)
  return new Intl.NumberFormat('zh-CN').format(number)
}

function formatDateLabel(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function getSeriesTrend(series, key) {
  if (!Array.isArray(series) || series.length < 2) {
    return { delta: 0, percent: 0 }
  }
  const current = Number(series[series.length - 1]?.[key] || 0)
  const previous = Number(series[series.length - 2]?.[key] || 0)
  const delta = current - previous
  const base = previous === 0 ? 1 : previous
  return {
    delta,
    percent: Math.round((delta / base) * 100)
  }
}

function getConfigValue(key, fallback = '') {
  const item = configs.value.find(entry => entry.key === key)
  if (!item) return fallback
  return item.value ?? fallback
}

function buildRecentDays(length = 7) {
  const values = []
  const base = new Date()
  for (let index = length - 1; index >= 0; index -= 1) {
    const current = new Date(base)
    current.setDate(base.getDate() - index)
    values.push(new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit'
    }).format(current))
  }
  return values
}

function normalizeSeries(rawSeries, dataKey) {
  if (Array.isArray(rawSeries) && rawSeries.length > 0) return rawSeries
  return buildRecentDays().map((date) => ({ date, [dataKey]: 0 }))
}

const dailyStats = computed(() => normalizeSeries(dashboardData.value.dailyStats, 'count'))
const dailyGames = computed(() => normalizeSeries(dashboardData.value.dailyGames, 'count'))
const dailyRevenue = computed(() => normalizeSeries(dashboardData.value.dailyRevenue, 'amount'))

const userTrend = computed(() => getSeriesTrend(dailyStats.value, 'count'))
const gameTrend = computed(() => getSeriesTrend(dailyGames.value, 'count'))
const revenueTrend = computed(() => getSeriesTrend(dailyRevenue.value, 'amount'))

const statCards = computed(() => {
  const metrics = [
    {
      key: 'totalUsers',
      label: '累计用户',
      value: formatNumber(dashboardData.value.totalUsers),
      note: '沉淀用户规模',
      trend: userTrend.value,
      icon: User,
      theme: 'is-primary'
    },
    {
      key: 'todayGames',
      label: '今日对局',
      value: formatNumber(dashboardData.value.todayGames),
      note: '全天开局次数',
      trend: gameTrend.value,
      icon: Monitor,
      theme: 'is-success'
    },
    {
      key: 'activeRooms',
      label: '进行中房间',
      value: formatNumber(dashboardData.value.activeRooms),
      note: '当前在线战场',
      trend: {
        delta: dashboardData.value.activeRooms,
        percent: dashboardData.value.activeRooms > 0 ? dashboardData.value.activeRooms : 0
      },
      icon: HomeFilled,
      theme: 'is-info'
    },
    {
      key: 'todayRevenue',
      label: '今日收入',
      value: formatNumber(dashboardData.value.todayRevenue),
      note: '金币净流入',
      trend: revenueTrend.value,
      icon: Coin,
      theme: 'is-warning'
    }
  ]

  return metrics.map((item) => {
    const trendUp = item.trend.delta >= 0
    return {
      ...item,
      trendLabel: trendUp ? `↑ ${Math.abs(item.trend.percent)}%` : `↓ ${Math.abs(item.trend.percent)}%`,
      trendText: item.key === 'activeRooms' ? '当前实时状态' : '较前一日',
      trendClass: trendUp ? 'trend-up' : 'trend-down'
    }
  })
})

const overviewChartOption = computed(() => {
  const labels = dailyStats.value.map(item => item.date)
  return {
    color: ['#e57c1f', '#2bbf9f', '#4f83cc'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 252, 246, 0.98)',
      borderColor: 'rgba(229, 124, 31, 0.22)',
      textStyle: { color: '#4a2d1a' }
    },
    legend: {
      top: 0,
      textStyle: { color: '#8a7051' }
    },
    grid: {
      left: 10,
      right: 10,
      bottom: 10,
      top: 48,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(177, 129, 66, 0.16)' } },
      axisLabel: { color: '#8a7051' },
      data: labels
    },
    yAxis: [
      {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(177, 129, 66, 0.12)', type: 'dashed' } },
        axisLabel: { color: '#8a7051' }
      },
      {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { color: '#8a7051' }
      }
    ],
    series: [
      {
        name: '活跃用户',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(229, 124, 31, 0.22)' },
              { offset: 1, color: 'rgba(229, 124, 31, 0.02)' }
            ]
          }
        },
        data: dailyStats.value.map(item => Number(item.count || 0))
      },
      {
        name: '对局数',
        type: 'bar',
        barWidth: 18,
        itemStyle: {
          borderRadius: [8, 8, 0, 0]
        },
        data: dailyGames.value.map(item => Number(item.count || 0))
      },
      {
        name: '收入',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          width: 2,
          type: 'dashed'
        },
        data: dailyRevenue.value.map(item => Number(item.amount || 0))
      }
    ]
  }
})

const healthMetrics = computed(() => {
  const avgGamesPerUser = dashboardData.value.totalUsers
    ? (dashboardData.value.todayGames / dashboardData.value.totalUsers) * 100
    : 0
  const gamesPerRoom = dashboardData.value.activeRooms
    ? (dashboardData.value.todayGames / dashboardData.value.activeRooms)
    : 0
  const revenuePerGame = dashboardData.value.todayGames
    ? (dashboardData.value.todayRevenue / dashboardData.value.todayGames)
    : 0
  const dailyAverageUsers = dailyStats.value.length
    ? dailyStats.value.reduce((sum, item) => sum + Number(item.count || 0), 0) / dailyStats.value.length
    : 0

  return [
    {
      label: '人均开局率',
      value: `${avgGamesPerUser.toFixed(1)}%`,
      status: avgGamesPerUser >= 5 ? '正常' : '偏低',
      type: avgGamesPerUser >= 5 ? 'success' : 'warning'
    },
    {
      label: '单房间承载',
      value: gamesPerRoom ? `${gamesPerRoom.toFixed(1)} 局` : '暂无',
      status: gamesPerRoom >= 1 ? '活跃' : '待拉起',
      type: gamesPerRoom >= 1 ? 'success' : 'info'
    },
    {
      label: '单局收入',
      value: revenuePerGame ? `${revenuePerGame.toFixed(1)} 金币` : '0',
      status: revenuePerGame >= 100 ? '良好' : '观察',
      type: revenuePerGame >= 100 ? 'success' : 'warning'
    },
    {
      label: '7 日活跃均值',
      value: `${dailyAverageUsers.toFixed(0)} 人`,
      status: dailyAverageUsers >= 10 ? '稳定' : '需投放',
      type: dailyAverageUsers >= 10 ? 'success' : 'danger'
    }
  ]
})

const healthSummary = computed(() => {
  const score = healthMetrics.value.reduce((sum, item) => {
    if (item.type === 'success') return sum + 25
    if (item.type === 'info') return sum + 18
    if (item.type === 'warning') return sum + 14
    return sum + 8
  }, 0)

  if (score >= 88) {
    return {
      score,
      tag: '健康',
      tagType: 'success',
      title: '当前盘面稳定',
      description: '核心指标处在可接受区间，适合继续做活动和商品转化。',
      levelClass: 'is-good'
    }
  }
  if (score >= 64) {
    return {
      score,
      tag: '关注',
      tagType: 'warning',
      title: '需要持续盯盘',
      description: '基础盘还能支撑，但流量或收入存在一项偏弱。',
      levelClass: 'is-watch'
    }
  }
  return {
    score,
    tag: '风险',
    tagType: 'danger',
    title: '建议尽快处理',
    description: '当前至少有两项核心指标偏弱，建议先排查配置和投放。',
    levelClass: 'is-risk'
  }
})

const healthTagType = computed(() => healthSummary.value.tagType)

const intensityMetrics = computed(() => {
  const dauPeak = Math.max(...dailyStats.value.map(item => Number(item.count || 0)), 0)
  const gamesPeak = Math.max(...dailyGames.value.map(item => Number(item.count || 0)), 0)
  const revenuePeak = Math.max(...dailyRevenue.value.map(item => Number(item.amount || 0)), 0)
  return [
    {
      label: 'DAU 峰值',
      value: `${formatNumber(dauPeak)} 人`,
      note: '近 7 日最高活跃'
    },
    {
      label: '对局峰值',
      value: `${formatNumber(gamesPeak)} 局`,
      note: '单日最大开局量'
    },
    {
      label: '收入峰值',
      value: `${formatNumber(revenuePeak)} 金币`,
      note: '单日最大变现'
    }
  ]
})

const capabilityCards = computed(() => {
  if (configLoadState.value === 'failed') {
    return [
      {
        title: '微信登录',
        status: '待连接',
        type: 'warning',
        note: '配置接口暂时不可用，当前先展示本地默认值，等后端恢复后会自动切回真实配置。'
      },
      {
        title: '微信分享',
        status: '待连接',
        type: 'warning',
        note: '分享能力状态暂未从服务端拉到，建议优先检查 `/api/admin/configs`。'
      },
      {
        title: '微信支付',
        status: '待连接',
        type: 'warning',
        note: '支付配置当前没有真实回传，页面不会再错误显示成已关闭。'
      }
    ]
  }

  const loginEnabled = getConfigValue('wechat.login_enabled', 'true') === 'true'
  const shareEnabled = getConfigValue('wechat.share_enabled', 'true') === 'true'
  const payEnabled = getConfigValue('wechat.pay_enabled', 'false') === 'true'

  const loginReady = !!getConfigValue('wechat.login_app_id') && !!getConfigValue('wechat.login_secret')
  const shareReady = !!getConfigValue('wechat.share_title') && !!getConfigValue('wechat.share_path') && !!getConfigValue('wechat.share_image_url')
  const payReady = !!getConfigValue('wechat.pay_mch_id') && !!getConfigValue('wechat.pay_api_v3_key') && !!getConfigValue('wechat.pay_notify_url')

  return [
    {
      title: '微信登录',
      status: loginEnabled ? (loginReady ? '已就绪' : '待补全') : '已关闭',
      type: loginEnabled ? (loginReady ? 'success' : 'warning') : 'info',
      note: loginEnabled ? (loginReady ? 'AppID 与 Secret 已配置，可接入登录态。' : '建议补齐 AppID、Secret、协议链接。') : '登录能力已关闭，用户无法通过微信授权进入。'
    },
    {
      title: '微信分享',
      status: shareEnabled ? (shareReady ? '可投放' : '待优化') : '已关闭',
      type: shareEnabled ? (shareReady ? 'success' : 'warning') : 'info',
      note: shareEnabled ? (shareReady ? '标题、落地页和分享图完整，可直接用于活动传播。' : '建议补齐分享标题、落地路径和卡片素材。') : '分享能力关闭，裂变传播入口当前不可用。'
    },
    {
      title: '微信支付',
      status: payEnabled ? (payReady ? '待联调' : '缺参数') : '未启用',
      type: payEnabled ? (payReady ? 'success' : 'danger') : 'info',
      note: payEnabled ? (payReady ? '商户号与回调参数已经具备，下一步可联调下单回调。' : '支付已经打开，但商户参数未完整配置，建议先补齐。') : '支付未启用，商城仅能做展示和非支付兑换。'
    }
  ]
})

const quickActions = [
  {
    label: '用户巡检',
    note: '查看新增与封禁状态',
    routeName: 'UserList',
    icon: User,
    theme: 'theme-orange'
  },
  {
    label: '对局监控',
    note: '检查实时房间和对局',
    routeName: 'GameList',
    icon: Monitor,
    theme: 'theme-green'
  },
  {
    label: '配置中心',
    note: '调整微信能力和系统参数',
    routeName: 'SystemConfig',
    icon: Tools,
    theme: 'theme-blue'
  },
  {
    label: '数据统计',
    note: '查看趋势和排行',
    routeName: 'StatsOverview',
    icon: TrendCharts,
    theme: 'theme-gold'
  },
  {
    label: '公告发布',
    note: '维护活动与停服通知',
    routeName: 'AnnouncementList',
    icon: Bell,
    theme: 'theme-red'
  },
  {
    label: '操作日志',
    note: '审计后台改动',
    routeName: 'OperationLogs',
    icon: ChatLineRound,
    theme: 'theme-ink'
  }
]

const lastUpdatedText = computed(() => {
  return lastUpdatedAt.value ? formatDateLabel(lastUpdatedAt.value) : '--'
})

async function fetchConfigs() {
  configLoadState.value = 'loading'
  try {
    const res = await request.get('/api/admin/configs')
    if (res.data.code === 0) {
      configs.value = res.data.data || []
      configLoadState.value = 'success'
      return
    }
    configs.value = fallbackConfigs
    configLoadState.value = 'failed'
  } catch (error) {
    configs.value = fallbackConfigs
    configLoadState.value = 'failed'
    console.error('Failed to fetch configs:', error)
  }
}

async function fetchDashboard() {
  loading.value = true
  try {
    const [dashRes, statsRes] = await Promise.all([
      request.get('/api/admin/dashboard'),
      request.get('/api/admin/stats/overview', { params: { limit: 7 } }),
      fetchConfigs()
    ])

    if (dashRes.data.code === 0) {
      dashboardData.value = { ...dashboardData.value, ...dashRes.data.data }
    }

    if (statsRes.data.code === 0) {
      const stats = statsRes.data.data || {}
      dashboardData.value.dailyStats = stats.dau || []
      dashboardData.value.dailyGames = stats.games || []
      dashboardData.value.dailyRevenue = stats.revenue || []
    }

    lastUpdatedAt.value = Date.now()
  } catch (error) {
    console.error('Failed to fetch dashboard:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchDashboard()
})
</script>

<style scoped>
.dashboard-hero {
  margin-bottom: 18px;
}

.hero-copy {
  max-width: 720px;
}

.hero-kicker {
  display: inline-block;
  margin-bottom: 10px;
  color: #c96a10;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.hero-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.hero-meta {
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 10px 14px;
  border: 1px solid rgba(177, 129, 66, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  color: #8a7051;
  font-size: 12px;
}

.hero-meta strong {
  margin-top: 4px;
  color: #4a2d1a;
  font-size: 15px;
}

.dashboard-grid {
  display: grid;
  gap: 18px;
  margin-bottom: 18px;
}

.top-grid {
  grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
}

.middle-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.overview-card,
.ops-card,
.panel-card {
  min-height: 100%;
}

.health-score {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(177, 129, 66, 0.14);
}

.score-ring {
  width: 88px;
  height: 88px;
  display: grid;
  place-items: center;
  border-radius: 24px;
  color: #fff;
  font-size: 28px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.score-ring.is-good {
  background: linear-gradient(135deg, #2bbf9f, #58c4aa);
}

.score-ring.is-watch {
  background: linear-gradient(135deg, #e57c1f, #f0ad4e);
}

.score-ring.is-risk {
  background: linear-gradient(135deg, #d9534f, #e27d77);
}

.score-title {
  color: #4a2d1a;
  font-size: 20px;
  font-weight: 760;
}

.score-note {
  margin: 8px 0 0;
  color: #8a7051;
  font-size: 13px;
  line-height: 1.6;
}

.health-list {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.health-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(177, 129, 66, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.58);
}

.health-label {
  color: #8a7051;
  font-size: 12px;
}

.health-value {
  margin-top: 5px;
  color: #4a2d1a;
  font-size: 20px;
  font-weight: 760;
}

.mini-metrics,
.capability-list {
  display: grid;
  gap: 12px;
}

.mini-metric,
.capability-item {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(177, 129, 66, 0.14);
  background: rgba(255, 255, 255, 0.58);
}

.mini-metric span,
.capability-item p {
  color: #8a7051;
  font-size: 13px;
}

.mini-metric strong {
  display: block;
  margin: 6px 0;
  color: #4a2d1a;
  font-size: 22px;
}

.mini-metric small {
  color: rgba(92, 63, 32, 0.58);
  font-size: 12px;
}

.capability-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.capability-head strong {
  color: #4a2d1a;
  font-size: 15px;
}

.capability-item p {
  margin: 0;
  line-height: 1.6;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.quick-action-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border: 1px solid rgba(177, 129, 66, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.64);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.quick-action-item:hover {
  transform: translateY(-2px);
  border-color: rgba(229, 124, 31, 0.28);
  box-shadow: 0 14px 28px rgba(96, 61, 27, 0.08);
}

.quick-action-item strong {
  color: #4a2d1a;
  font-size: 15px;
}

.quick-action-item span {
  color: #8a7051;
  font-size: 12px;
  text-align: left;
}

.quick-action-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  font-size: 20px;
}

.theme-orange {
  color: #e57c1f;
  background: rgba(229, 124, 31, 0.14);
}

.theme-green {
  color: #2bbf9f;
  background: rgba(43, 191, 159, 0.14);
}

.theme-blue {
  color: #4f83cc;
  background: rgba(79, 131, 204, 0.14);
}

.theme-gold {
  color: #d2a45a;
  background: rgba(210, 164, 90, 0.16);
}

.theme-red {
  color: #d9534f;
  background: rgba(217, 83, 79, 0.14);
}

.theme-ink {
  color: #4a2d1a;
  background: rgba(74, 45, 26, 0.12);
}

@media (max-width: 1280px) {
  .top-grid,
  .middle-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hero-actions {
    justify-content: flex-start;
  }

  .quick-actions {
    grid-template-columns: 1fr;
  }
}
</style>
