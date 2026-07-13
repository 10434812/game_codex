<template>
  <div class="fortune-reality-page">
    <section class="page-hero fortune-hero">
      <div class="hero-copy">
        <span class="hero-kicker">FORTUNE REALITY FEED</span>
        <h1>福袋现实数据</h1>
        <p>把中国股票、中国房产、比特币等现实行情抓入数据库，默认优先展示中国市场，同时保留美股与美国房产代理源。</p>
      </div>
      <div class="hero-actions">
        <el-button @click="fetchAll" :loading="loading">刷新页面</el-button>
        <el-button type="primary" @click="refreshSources" :loading="refreshing">立即抓取</el-button>
        <el-button type="warning" plain @click="generateReport" :loading="generatingReport">生成摘要</el-button>
      </div>
    </section>

    <section class="fortune-status-grid">
      <el-card v-for="item in statusCards" :key="item.title" shadow="never" class="status-card">
        <div class="status-head">
          <span class="status-label">{{ item.title }}</span>
          <el-tag size="small" :type="item.type">{{ item.tag }}</el-tag>
        </div>
        <div class="status-value">{{ item.value }}</div>
        <div class="status-note">{{ item.note }}</div>
      </el-card>
    </section>

    <section class="fortune-grid">
      <el-card shadow="never" class="report-card">
        <template #header>
          <div class="card-header">
            <span>最新福袋摘要</span>
            <el-tag :type="sentimentTag(report?.sentiment)">{{ sentimentText(report?.sentiment) }}</el-tag>
          </div>
        </template>
        <div v-if="report" class="report-body">
          <h3>{{ report.title }}</h3>
          <p>{{ report.summary }}</p>
          <div class="report-meta">
            <span>{{ report.modelProvider || 'local-rule' }}</span>
            <span>{{ report.modelName || 'heuristic' }}</span>
            <span>{{ report.generatedAt || '-' }}</span>
          </div>
        </div>
        <el-empty v-else description="还没有摘要，先执行一次抓取或手动生成" />
      </el-card>

      <el-card shadow="never" class="source-card">
        <template #header>
          <div class="card-header">
            <span>数据源状态</span>
            <el-tag size="small" type="info">{{ sources.length }} 个源</el-tag>
          </div>
        </template>
        <el-table :data="sources" size="small" v-loading="loading" max-height="360">
          <el-table-column prop="name" label="数据源" min-width="180" show-overflow-tooltip />
          <el-table-column label="类别" width="100">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ categoryText(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="sourceStatusType(row)">
                {{ row.isActive ? statusText(row.lastStatus) : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="lastFetchedAt" label="最后抓取" width="160" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="refreshSingle(row)">抓取</el-button>
              <el-button link type="primary" size="small" @click="openSourceDialog(row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <el-card shadow="never" class="snapshot-card">
      <template #header>
        <div class="card-header">
          <span>现实快照入库记录</span>
          <div class="table-tools">
            <el-select v-model="categoryFilter" clearable placeholder="全部类别" style="width: 150px" @change="fetchSnapshots">
              <el-option label="股票" value="stock" />
              <el-option label="比特币" value="crypto" />
              <el-option label="房产" value="real_estate" />
              <el-option label="宏观" value="macro" />
              <el-option label="资讯" value="news" />
            </el-select>
          </div>
        </div>
      </template>
      <el-table :data="snapshots" v-loading="loading" stripe>
        <el-table-column prop="name" label="名称" min-width="180" />
        <el-table-column prop="metricLabel" label="指标" min-width="140" />
        <el-table-column label="数值" width="140">
          <template #default="{ row }">
            <strong>{{ formatMetric(row) }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="变化" width="120">
          <template #default="{ row }">
            <el-tag :type="trendTag(row.trend)" size="small">{{ formatChange(row.changePercent) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="summary" label="摘要" min-width="260" show-overflow-tooltip />
        <el-table-column prop="observedAt" label="观察时间" width="170" />
      </el-table>
    </el-card>

    <el-dialog v-model="sourceDialogVisible" title="编辑福袋现实数据源" width="720px">
      <el-form :model="sourceForm" label-width="110px">
        <el-form-item label="名称">
          <el-input v-model="sourceForm.name" />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="sourceForm.category" style="width: 100%">
            <el-option label="股票" value="stock" />
            <el-option label="比特币" value="crypto" />
            <el-option label="房产" value="real_estate" />
            <el-option label="宏观" value="macro" />
            <el-option label="资讯" value="news" />
          </el-select>
        </el-form-item>
        <el-form-item label="解析方式">
          <el-select v-model="sourceForm.provider" style="width: 100%">
            <el-option label="CoinGecko" value="coingecko" />
            <el-option label="Stooq CSV" value="stooq" />
            <el-option label="新浪行情" value="sina_quote" />
            <el-option label="通用 JSON" value="json" />
            <el-option label="通用 CSV" value="csv" />
            <el-option label="RSS" value="rss" />
            <el-option label="手动" value="manual" />
          </el-select>
        </el-form-item>
        <el-form-item label="抓取地址">
          <el-input v-model="sourceForm.endpointUrl" />
        </el-form-item>
        <el-form-item label="刷新间隔">
          <el-input-number v-model="sourceForm.refreshIntervalSeconds" :min="60" :step="60" controls-position="right" />
          <span class="form-help">秒</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="sourceForm.isActive" />
        </el-form-item>
        <el-form-item label="解析配置">
          <el-input v-model="sourceForm.parserConfigText" type="textarea" :rows="7" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sourceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingSource" @click="saveSource">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const refreshing = ref(false)
const generatingReport = ref(false)
const savingSource = ref(false)
const summary = ref(null)
const sources = ref([])
const snapshots = ref([])
const report = ref(null)
const categoryFilter = ref('')
const sourceDialogVisible = ref(false)
const editingSourceId = ref(null)

const sourceForm = reactive({
  name: '',
  category: 'stock',
  provider: 'stooq',
  endpointUrl: '',
  refreshIntervalSeconds: 900,
  isActive: true,
  parserConfigText: '{}'
})

const statusCards = computed(() => {
  const latest = summary.value?.latestObservedAt || '-'
  return [
    {
      title: '启用数据源',
      value: `${summary.value?.activeSources || 0}/${summary.value?.totalSources || sources.value.length}`,
      note: '启用的数据源会被定时任务和手动刷新抓取',
      tag: 'Sources',
      type: 'success'
    },
    {
      title: '入库快照',
      value: String(summary.value?.totalSnapshots || snapshots.value.length || 0),
      note: '每次抓取都会写入一条现实数据快照',
      tag: 'DB',
      type: 'warning'
    },
    {
      title: '最近观察',
      value: latest === '-' ? '-' : latest.slice(5, 16),
      note: latest === '-' ? '还没有成功入库的数据' : latest,
      tag: 'Live',
      type: latest === '-' ? 'info' : 'success'
    },
    {
      title: '摘要来源',
      value: report.value?.modelProvider || 'local-rule',
      note: report.value?.modelName || '未配置模型 key 时使用规则摘要',
      tag: 'AI',
      type: report.value?.modelProvider?.includes('fallback') ? 'warning' : 'info'
    }
  ]
})

function categoryText(value) {
  const map = {
    stock: '股票',
    crypto: '比特币',
    real_estate: '房产',
    macro: '宏观',
    news: '资讯'
  }
  return map[value] || value || '-'
}

function statusText(value) {
  const map = { idle: '待抓取', success: '成功', failed: '失败' }
  return map[value] || value || '待抓取'
}

function sourceStatusType(row) {
  if (!row.isActive) return 'info'
  if (row.lastStatus === 'success') return 'success'
  if (row.lastStatus === 'failed') return 'danger'
  return 'warning'
}

function trendTag(value) {
  if (value === 'up') return 'danger'
  if (value === 'down') return 'success'
  if (value === 'flat') return 'info'
  return ''
}

function sentimentText(value) {
  const map = { positive: '偏积极', neutral: '中性', negative: '偏谨慎', mixed: '分化' }
  return map[value] || '未生成'
}

function sentimentTag(value) {
  const map = { positive: 'danger', neutral: 'info', negative: 'success', mixed: 'warning' }
  return map[value] || 'info'
}

function formatChange(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '暂无'
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`
}

function formatMetric(row) {
  const number = Number(row.metricValue)
  if (!Number.isFinite(number)) return '-'
  const value = number > 1000 ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : number.toFixed(2)
  return `${value}${row.currency ? ` ${row.currency}` : ''}`
}

async function fetchSummary() {
  const res = await request.get('/api/admin/fortune/summary')
  if (res.data.code === 0) {
    summary.value = res.data.data || null
    report.value = summary.value?.latestReport || report.value
  }
}

async function fetchSources() {
  const res = await request.get('/api/admin/fortune/sources')
  if (res.data.code === 0) {
    sources.value = res.data.data || []
  }
}

async function fetchSnapshots() {
  const res = await request.get('/api/admin/fortune/snapshots', {
    limit: 80,
    category: categoryFilter.value || undefined
  })
  if (res.data.code === 0) {
    snapshots.value = res.data.data || []
  }
}

async function fetchReport() {
  const res = await request.get('/api/admin/fortune/report/latest')
  if (res.data.code === 0) {
    report.value = res.data.data || null
  }
}

async function fetchAll() {
  loading.value = true
  try {
    await Promise.all([fetchSummary(), fetchSources(), fetchSnapshots(), fetchReport()])
  } catch (_err) {
    ElMessage.error('获取福袋现实数据失败')
  } finally {
    loading.value = false
  }
}

async function refreshSources() {
  refreshing.value = true
  try {
    const res = await request.post('/api/admin/fortune/refresh', { force: true, generateReport: true })
    if (res.data.code === 0) {
      const failed = res.data.data?.failed || []
      if (failed.length) {
        ElMessage.warning(`抓取完成，但 ${failed.length} 个数据源失败`)
      } else {
        ElMessage.success('福袋现实数据已刷新')
      }
      await fetchAll()
    }
  } catch (_err) {
    ElMessage.error('刷新福袋现实数据失败')
  } finally {
    refreshing.value = false
  }
}

async function refreshSingle(row) {
  refreshing.value = true
  try {
    const res = await request.post('/api/admin/fortune/refresh', {
      sourceKey: row.sourceKey,
      force: true,
      generateReport: true
    })
    const failed = res.data.data?.failed || []
    if (failed.length) {
      ElMessage.error(failed[0].error || '数据源抓取失败')
    } else {
      ElMessage.success(`${row.name} 已刷新`)
    }
    await fetchAll()
  } catch (_err) {
    ElMessage.error('数据源抓取失败')
  } finally {
    refreshing.value = false
  }
}

async function generateReport() {
  generatingReport.value = true
  try {
    const res = await request.post('/api/admin/fortune/report/generate')
    if (res.data.code === 0) {
      report.value = res.data.data || null
      ElMessage.success('福袋摘要已生成')
    }
  } catch (_err) {
    ElMessage.error('生成福袋摘要失败')
  } finally {
    generatingReport.value = false
  }
}

function openSourceDialog(row) {
  editingSourceId.value = row.id
  Object.assign(sourceForm, {
    name: row.name || '',
    category: row.category || 'stock',
    provider: row.provider || 'stooq',
    endpointUrl: row.endpointUrl || row.endpoint_url || '',
    refreshIntervalSeconds: Number(row.refreshIntervalSeconds || 900),
    isActive: !!row.isActive,
    parserConfigText: JSON.stringify(row.parserConfig || {}, null, 2)
  })
  sourceDialogVisible.value = true
}

async function saveSource() {
  let parserConfig = {}
  try {
    parserConfig = JSON.parse(sourceForm.parserConfigText || '{}')
  } catch (_err) {
    ElMessage.error('解析配置必须是合法 JSON')
    return
  }

  savingSource.value = true
  try {
    await request.put(`/api/admin/fortune/sources/${editingSourceId.value}`, {
      name: sourceForm.name,
      category: sourceForm.category,
      provider: sourceForm.provider,
      endpointUrl: sourceForm.endpointUrl,
      refreshIntervalSeconds: sourceForm.refreshIntervalSeconds,
      isActive: sourceForm.isActive,
      parserConfig
    })
    sourceDialogVisible.value = false
    ElMessage.success('数据源已保存')
    await fetchAll()
  } catch (_err) {
    ElMessage.error('保存数据源失败')
  } finally {
    savingSource.value = false
  }
}

onMounted(fetchAll)
</script>

<style scoped>
.fortune-hero {
  margin-bottom: 16px;
}

.hero-copy {
  max-width: 780px;
}

.hero-kicker {
  display: inline-block;
  margin-bottom: 10px;
  color: #c96a10;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.hero-actions,
.table-tools,
.report-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.fortune-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.fortune-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  gap: 16px;
  margin-bottom: 16px;
}

.status-card,
.report-card,
.source-card,
.snapshot-card {
  background: rgba(255, 252, 246, 0.9);
}

.status-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.status-label {
  color: #8a7051;
  font-size: 13px;
}

.status-value {
  margin-top: 10px;
  color: #4a2d1a;
  font-size: 26px;
  font-weight: 800;
}

.status-note {
  margin-top: 8px;
  color: #9c7a52;
  font-size: 12px;
  line-height: 1.6;
}

.report-body h3 {
  margin: 0;
  color: #4a2d1a;
  font-size: 18px;
}

.report-body p {
  margin: 12px 0 0;
  color: #6b4a2b;
  line-height: 1.75;
}

.report-meta {
  margin-top: 16px;
  color: #9c7a52;
  font-size: 12px;
}

.form-help {
  margin-left: 10px;
  color: #8a7051;
  font-size: 13px;
}

@media (max-width: 1280px) {
  .fortune-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fortune-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .fortune-status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
