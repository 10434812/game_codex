<template>
  <div class="dashboard-page">
    <!-- Stat Cards Row -->
    <div class="stat-cards">
      <el-card class="stat-card" shadow="never" v-for="stat in statCards" :key="stat.key">
        <div class="stat-card-content">
          <div class="stat-info">
            <div class="stat-label">{{ stat.label }}</div>
            <div class="stat-value">{{ dashboardData[stat.key] ?? '--' }}</div>
            <div class="stat-trend" v-if="stat.trend !== undefined">
              <span :class="stat.trend >= 0 ? 'trend-up' : 'trend-down'">
                {{ stat.trend >= 0 ? '↑' : '↓' }} {{ Math.abs(stat.trend) }}%
              </span>
              <span class="trend-text">较昨日</span>
            </div>
          </div>
          <div class="stat-icon-wrap" :class="'is-' + stat.key">
            <el-icon class="stat-icon"><component :is="stat.icon" /></el-icon>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Charts Row -->
    <el-row :gutter="20" class="charts-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>近7日活跃用户（DAU）</span>
              <el-tag size="small" type="warning">本周</el-tag>
            </div>
          </template>
          <v-chart :option="dauChartOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>每日对局数</span>
              <el-tag size="small" type="success">本周</el-tag>
            </div>
          </template>
          <v-chart :option="gamesChartOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
    </el-row>

    <!-- Bottom Section: Revenue Chart + Quick Actions -->
    <el-row :gutter="20">
      <el-col :xs="24" :lg="16">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>近7日收入趋势</span>
              <el-tag size="small" type="danger">金币</el-tag>
            </div>
          </template>
          <v-chart :option="revenueChartOption" style="height: 280px" autoresize />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="8">
        <el-card shadow="never" class="quick-actions-card">
          <template #header>
            <span>快捷操作</span>
          </template>
          <div class="quick-actions">
            <div class="quick-action-item" @click="$router.push({ name: 'UserList' })">
              <el-icon class="qa-icon" :size="24"><User /></el-icon>
              <span>用户管理</span>
            </div>
            <div class="quick-action-item" @click="$router.push({ name: 'GameList' })">
              <el-icon class="qa-icon" :size="24"><Monitor /></el-icon>
              <span>对局监控</span>
            </div>
            <div class="quick-action-item" @click="$router.push({ name: 'RoomList' })">
              <el-icon class="qa-icon" :size="24"><Coin /></el-icon>
              <span>房间管理</span>
            </div>
            <div class="quick-action-item" @click="$router.push({ name: 'StatsOverview' })">
              <el-icon class="qa-icon" :size="24"><TrendCharts /></el-icon>
              <span>数据统计</span>
            </div>
            <div class="quick-action-item" @click="$router.push({ name: 'AnnouncementList' })">
              <el-icon class="qa-icon" :size="24"><Bell /></el-icon>
              <span>发布公告</span>
            </div>
            <div class="quick-action-item" @click="$router.push({ name: 'AdminList' })">
              <el-icon class="qa-icon" :size="24"><Setting /></el-icon>
              <span>管理员</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import {
  User, Monitor, Coin, TrendCharts, Bell, Setting,
  HomeFilled
} from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'
import request from '@/utils/request'

use([CanvasRenderer, LineChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const dashboardData = ref({
  totalUsers: 0,
  todayGames: 0,
  activeRooms: 0,
  todayRevenue: 0,
  dailyStats: [],
  dailyGames: [],
  dailyRevenue: []
})

const statCards = computed(() => [
  { key: 'totalUsers', label: '总用户数', icon: User, trend: 12 },
  { key: 'todayGames', label: '今日对局', icon: Monitor, trend: -3 },
  { key: 'activeRooms', label: '活跃房间', icon: HomeFilled, trend: 5 },
  { key: 'todayRevenue', label: '今日收入', icon: Coin, trend: 8 }
])

function makeLineOption(data, name, color, dataKey = 'count') {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: '#e57c1f',
      borderWidth: 1,
      textStyle: { color: '#4a2d1a' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(205,171,114,0.3)' } },
      axisLabel: { color: '#8a7051' },
      data: data.map(s => s.date)
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'rgba(205,171,114,0.15)', type: 'dashed' } },
      axisLabel: { color: '#8a7051' }
    },
    series: [{
      name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 3, color },
      itemStyle: { color },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: color.replace(')', ',0.25)').replace('rgb', 'rgba') },
            { offset: 1, color: color.replace(')', ',0.02)').replace('rgb', 'rgba') }
          ]
        }
      },
      data: data.map(s => s[dataKey])
    }]
  }
}

function makeBarOption(data, name, color) {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderColor: '#e57c1f',
      borderWidth: 1,
      textStyle: { color: '#4a2d1a' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: 'rgba(205,171,114,0.3)' } },
      axisLabel: { color: '#8a7051' },
      data: data.map(s => s.date)
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: 'rgba(205,171,114,0.15)', type: 'dashed' } },
      axisLabel: { color: '#8a7051' }
    },
    series: [{
      name,
      type: 'bar',
      barWidth: '40%',
      itemStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color },
            { offset: 1, color: color.replace(')', ',0.6)').replace('rgb', 'rgba') }
          ]
        },
        borderRadius: [4, 4, 0, 0]
      },
      data: data.map(s => s.count)
    }]
  }
}

const e57c1f = 'rgb(229,124,31)'
const brandSuccess = 'rgb(43,191,159)'
const brandWarning = 'rgb(240,173,78)'

const dauChartOption = computed(() => {
  const stats = dashboardData.value.dailyStats || []
  return makeLineOption(stats, '活跃用户', e57c1f)
})

const gamesChartOption = computed(() => {
  const stats = dashboardData.value.dailyGames || dashboardData.value.dailyStats || []
  return makeBarOption(stats, '对局数', brandSuccess)
})

const revenueChartOption = computed(() => {
  const stats = dashboardData.value.dailyRevenue || dashboardData.value.dailyStats || []
  return makeLineOption(stats, '收入', brandWarning, 'amount')
})

async function fetchDashboard() {
  try {
    const [dashRes, statsRes] = await Promise.all([
      request.get('/api/admin/dashboard'),
      request.get('/api/admin/stats/overview', { params: { limit: 7 } })
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
  } catch (err) {
    console.error('Failed to fetch dashboard:', err)
  }
}

onMounted(() => {
  fetchDashboard()
})
</script>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 4px;
  font-weight: 500;
}

.stat-value {
  font-size: 30px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.2;
  margin-bottom: 4px;
}

.stat-trend {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.trend-up { color: var(--el-color-success); font-weight: 600; }
.trend-down { color: var(--el-color-danger); font-weight: 600; }
.trend-text { color: var(--el-text-color-placeholder); }

.stat-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon-wrap.is-totalUsers { background: rgba(229, 124, 31, 0.12); }
.stat-icon-wrap.is-todayGames { background: rgba(43, 191, 159, 0.12); }
.stat-icon-wrap.is-activeRooms { background: rgba(64, 158, 255, 0.12); }
.stat-icon-wrap.is-todayRevenue { background: rgba(240, 173, 78, 0.12); }

.stat-icon {
  font-size: 28px;
}

.stat-icon-wrap.is-totalUsers .stat-icon { color: #e57c1f; }
.stat-icon-wrap.is-todayGames .stat-icon { color: #2bbf9f; }
.stat-icon-wrap.is-activeRooms .stat-icon { color: #409eff; }
.stat-icon-wrap.is-todayRevenue .stat-icon { color: #f0ad4e; }

.charts-row {
  margin-bottom: 20px;
}

.quick-actions-card .el-card__body {
  padding: 16px !important;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.quick-action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(229, 124, 31, 0.04);
  border: 1px solid transparent;
}

.quick-action-item:hover {
  background: rgba(229, 124, 31, 0.1);
  border-color: rgba(229, 124, 31, 0.2);
  transform: translateY(-2px);
}

.qa-icon {
  color: var(--el-color-primary);
}

.quick-action-item span {
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
}
</style>
