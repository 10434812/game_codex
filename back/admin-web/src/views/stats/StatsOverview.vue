<template>
  <div class="stats-page">
    <!-- Date Range Filter -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-row">
        <el-icon size="18"><Calendar /></el-icon>
        <span style="font-weight:500;color:var(--el-text-color-primary)">统计周期</span>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          @change="fetchStats"
          style="width: 300px"
        />
        <el-button type="primary" @click="fetchStats">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
      </div>
    </el-card>

    <!-- Summary Stats Row -->
    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :xs="12" :sm="6" v-for="s in summaryStats" :key="s.key">
        <el-card shadow="never" class="summary-stat-card">
          <div class="summary-stat-value" :style="{ color: s.color }">{{ s.value }}</div>
          <div class="summary-stat-label">{{ s.label }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Charts Row -->
    <el-row :gutter="20" class="charts-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>日活跃用户（DAU）</span>
              <el-tag size="small" type="warning">趋势</el-tag>
            </div>
          </template>
          <v-chart :option="dauOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>每日对局数</span>
              <el-tag size="small" type="success">趋势</el-tag>
            </div>
          </template>
          <v-chart :option="gamesOption" style="height: 320px" autoresize />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="charts-row">
      <el-col :xs="24">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>每日收入</span>
              <el-tag size="small" type="danger">金币</el-tag>
            </div>
          </template>
          <v-chart :option="revenueOption" style="height: 300px" autoresize />
        </el-card>
      </el-col>
    </el-row>

    <!-- Leaderboard -->
    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="card-header">
          <span>🏆 高分玩家 Top 50</span>
        </div>
      </template>
      <el-table :data="topPlayers" size="small" stripe>
        <el-table-column type="index" label="排名" width="60" />
        <el-table-column prop="nick_name" label="昵称" min-width="120">
          <template #default="{ row }">
            <div style="display:flex;align-items:center;gap:8px">
              <el-avatar :src="row.avatar_url" :size="28" />
              <span>{{ row.nick_name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="level" label="等级" width="80" sortable />
        <el-table-column prop="game_count" label="总局数" width="80" sortable />
        <el-table-column prop="win_count" label="胜场" width="80" sortable />
        <el-table-column label="胜率" width="80">
          <template #default="{ row }">
            <span v-if="row.game_count > 0">
              {{ ((row.win_count / row.game_count) * 100).toFixed(1) }}%
            </span>
            <span v-else>--</span>
          </template>
        </el-table-column>
        <el-table-column prop="coins" label="金币" width="100" sortable>
          <template #default="{ row }">
            <span style="color:#e57c1f;font-weight:600">{{ row.coins.toLocaleString() }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { Calendar } from '@element-plus/icons-vue'
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
import { ElMessage } from 'element-plus'

use([CanvasRenderer, LineChart, BarChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

const dateRange = ref([])
const statsData = ref({ dau: [], games: [], revenue: [] })
const topPlayers = ref([])

const summaryStats = computed(() => {
  const dau = statsData.value.dau || []
  const games = statsData.value.games || []
  const revenue = statsData.value.revenue || []
  const totalDau = dau.reduce((sum, d) => sum + (d.count || d.dau || 0), 0)
  const totalGames = games.reduce((sum, d) => sum + (d.count || 0), 0)
  const totalRevenue = revenue.reduce((sum, d) => sum + (d.amount || 0), 0)
  const avgDau = dau.length > 0 ? Math.round(totalDau / dau.length) : 0
  return [
    { key: 'avgDau', label: '日均DAU', value: avgDau, color: '#e57c1f' },
    { key: 'totalGames', label: '总对局数', value: totalGames, color: '#2bbf9f' },
    { key: 'totalRevenue', label: '总收入', value: totalRevenue.toLocaleString(), color: '#f0ad4e' },
    { key: 'avgDauRatio', label: '数据天数', value: dau.length + ' 天', color: '#409eff' }
  ]
})

function makeChartOption(data, config) {
  const { name, type, color, dataKey = 'count', symbolSize = 6 } = config
  const isLine = type === 'line'
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
      minInterval: isLine ? 1 : undefined,
      splitLine: { lineStyle: { color: 'rgba(205,171,114,0.15)', type: 'dashed' } },
      axisLabel: { color: '#8a7051' }
    },
    series: [{
      name,
      type,
      smooth: isLine,
      symbol: isLine ? 'circle' : 'none',
      symbolSize: isLine ? symbolSize : 0,
      barWidth: '40%',
      lineStyle: isLine ? { width: 3, color } : undefined,
      itemStyle: {
        color: isLine ? color : {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color },
            { offset: 1, color: color.replace(')', ',0.6)').replace('rgb', 'rgba') }
          ]
        },
        borderRadius: isLine ? undefined : [4, 4, 0, 0]
      },
      areaStyle: isLine ? {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: color.replace(')', ',0.25)').replace('rgb', 'rgba') },
            { offset: 1, color: color.replace(')', ',0.02)').replace('rgb', 'rgba') }
          ]
        }
      } : undefined,
      data: data.map(s => s[dataKey])
    }]
  }
}

const e57c1f = 'rgb(229,124,31)'
const brandSuccess = 'rgb(43,191,159)'
const brandWarning = 'rgb(240,173,78)'

const dauOption = computed(() => makeChartOption(statsData.value.dau || [], { name: 'DAU', type: 'line', color: e57c1f, dataKey: 'count' }))
const gamesOption = computed(() => makeChartOption(statsData.value.games || [], { name: '对局数', type: 'bar', color: brandSuccess }))
const revenueOption = computed(() => makeChartOption(statsData.value.revenue || [], { name: '收入', type: 'line', color: brandWarning, dataKey: 'amount' }))

async function fetchStats() {
  try {
    const params = {}
    if (dateRange.value?.length === 2) {
      params.from = dateRange.value[0]
      params.to = dateRange.value[1]
    }
    const [statsRes, topRes] = await Promise.all([
      request.get('/api/admin/stats/overview', { params }),
      request.get('/api/admin/stats/top-players', { params: { limit: 50 } })
    ])
    if (statsRes.data.code === 0) {
      statsData.value = { dau: [], games: [], revenue: [], ...statsRes.data.data }
    }
    if (topRes.data.code === 0) {
      topPlayers.value = topRes.data.data || []
    }
  } catch (err) {
    ElMessage.error('获取统计数据失败')
  }
}

function resetFilter() {
  dateRange.value = []
  fetchStats()
}

onMounted(() => {
  fetchStats()
})
</script>

<style scoped>
.filter-card {
  margin-bottom: 20px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-stat-card {
  text-align: center;
}

.summary-stat-card .el-card__body {
  padding: 20px 16px !important;
}

.summary-stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 4px;
}

.summary-stat-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.charts-row {
  margin-bottom: 20px;
}

.section-card {
  margin-top: 20px;
}
</style>
