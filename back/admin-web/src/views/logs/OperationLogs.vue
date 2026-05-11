<template>
  <div class="operation-logs-page">
    <!-- Stats Summary -->
    <el-card class="stats-card" shadow="hover">
      <div class="stats-summary">
        <div class="stat-item">
          <span class="stat-label">总日志数</span>
          <span class="stat-value">{{ stats.total ?? 0 }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item" v-for="item in actionDistribution" :key="item.action">
          <span class="stat-label">{{ actionLabel(item.action) }}</span>
          <span class="stat-value">{{ item.count }}</span>
        </div>
      </div>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>操作日志</span>
        </div>
        <div class="filter-bar">
          <el-select v-model="actionFilter" placeholder="操作类型" clearable style="width: 140px" @change="fetchLogs">
            <el-option label="全部操作" value="" />
            <el-option label="创建" value="create" />
            <el-option label="更新" value="update" />
            <el-option label="删除" value="delete" />
            <el-option label="登录" value="login" />
            <el-option label="封禁" value="ban" />
            <el-option label="解封" value="unban" />
          </el-select>
          <el-select v-model="targetTypeFilter" placeholder="目标类型" clearable style="width: 140px" @change="fetchLogs">
            <el-option label="全部类型" value="" />
            <el-option label="用户" value="user" />
            <el-option label="管理" value="admin" />
            <el-option label="道具" value="item" />
            <el-option label="对局" value="game" />
            <el-option label="房间" value="room" />
          </el-select>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 260px"
            @change="fetchLogs"
          />
          <el-input
            v-model="adminSearch"
            placeholder="搜索管理员"
            clearable
            style="width: 160px"
            @clear="fetchLogs"
            @keyup.enter="fetchLogs"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button @click="fetchLogs">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <el-table
        :data="logs"
        v-loading="loading"
        stripe
        @expand-change="handleExpandChange"
        :row-key="(row) => row.id"
      >
        <el-table-column type="expand" width="40">
          <template #default="{ row }">
            <div class="expand-detail">
              <pre class="json-detail">{{ formatJSON(row.detail) }}</pre>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="adminName" label="管理员" width="120" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)" size="small">
              {{ actionLabel(row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="targetType" label="目标类型" width="100" />
        <el-table-column prop="targetId" label="目标ID" width="120" show-overflow-tooltip />
        <el-table-column label="详情" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="detail-preview">{{ previewDetail(row.detail) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column prop="createdAt" label="操作时间" width="170" />
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="fetchLogs"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Search, Refresh } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const logs = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const stats = ref({ total: 0, distribution: [] })

const actionFilter = ref('')
const targetTypeFilter = ref('')
const dateRange = ref(null)
const adminSearch = ref('')

const actionDistribution = computed(() => {
  return stats.value.distribution || []
})

function actionLabel(action) {
  const map = {
    create: '创建',
    update: '更新',
    delete: '删除',
    login: '登录',
    ban: '封禁',
    unban: '解封'
  }
  return map[action] || action
}

function actionTagType(action) {
  const map = {
    create: 'success',
    update: 'primary',
    delete: 'danger',
    login: 'info',
    ban: 'warning',
    unban: 'success'
  }
  return map[action] || ''
}

function previewDetail(detail) {
  if (!detail) return '--'
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail)
      return JSON.stringify(parsed).substring(0, 80) + '...'
    } catch {
      return detail.substring(0, 80) + '...'
    }
  }
  return JSON.stringify(detail).substring(0, 80) + '...'
}

function formatJSON(detail) {
  if (!detail) return '{}'
  if (typeof detail === 'string') {
    try {
      return JSON.stringify(JSON.parse(detail), null, 2)
    } catch {
      return detail
    }
  }
  return JSON.stringify(detail, null, 2)
}

function handleExpandChange(row, expandedRows) {
  // No-op, kept for future use
}

async function fetchStats() {
  try {
    const res = await request.get('/api/admin/logs/stats')
    if (res.data.code === 0) {
      stats.value = res.data.data || { total: 0, distribution: [] }
    }
  } catch (err) {
    // Silently fail
  }
}

async function fetchLogs() {
  loading.value = true
  try {
    const params = {
      page: page.value,
      limit: limit.value,
      action: actionFilter.value || undefined,
      targetType: targetTypeFilter.value || undefined,
      adminId: adminSearch.value || undefined,
      dateFrom: dateRange.value ? dateRange.value[0] : undefined,
      dateTo: dateRange.value ? dateRange.value[1] : undefined
    }
    const res = await request.get('/api/admin/logs', { params })
    if (res.data.code === 0) {
      logs.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取操作日志失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchStats()
  fetchLogs()
})
</script>

<style scoped>
.stats-card {
  margin-bottom: 16px;
}

.stats-summary {
  display: flex;
  align-items: center;
  gap: 24px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.stat-value {
  font-size: 22px;
  font-weight: bold;
  color: #303133;
}

.stat-divider {
  width: 1px;
  height: 32px;
  background: #dcdfe6;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.filter-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.expand-detail {
  padding: 12px 20px;
}

.json-detail {
  margin: 0;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Courier New', Courier, monospace;
}

.detail-preview {
  color: #909399;
  font-size: 12px;
}
</style>
