<template>
  <div class="game-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>对局监控</span>
          <div class="header-actions">
            <el-select v-model="statusFilter" placeholder="全部状态" aria-label="状态筛选" clearable style="width: 140px" @change="onFilterChange">
              <el-option label="进行中" value="playing" />
              <el-option label="已结束" value="finished" />
            </el-select>
            <el-select v-model="modeFilter" placeholder="全部来源" aria-label="来源筛选" clearable style="width: 144px" @change="onFilterChange">
              <el-option v-for="mode in gameModes" :key="mode.value" :label="mode.label" :value="mode.value" />
            </el-select>
            <el-button @click="fetchGames">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <el-table
        :data="games"
        v-loading="loading"
        stripe
        @row-click="(row) => $router.push({ name: 'GameDetail', params: { id: row.sessionId } })"
        row-class-name="clickable-row"
      >
        <el-table-column prop="sessionId" label="对局ID" width="90" />
        <el-table-column prop="roomCode" label="房间码" width="120" />
        <el-table-column label="来源" width="106">
          <template #default="{ row }">
            <el-tag :type="gameMode(row.mode).type" size="small">{{ gameMode(row.mode).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="scenicName" label="景区" width="100" />
        <el-table-column prop="playerCount" label="真人数" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="startedAt" label="开始时间" width="170" />
        <el-table-column label="时长" width="100">
          <template #default="{ row }">
            {{ row.duration == null ? '—' : `${row.duration} 秒` }}
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="85">
          <template #default="{ row }">
            <router-link class="detail-link" :to="{ name: 'GameDetail', params: { id: row.sessionId } }" @click.stop>详情</router-link>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="fetchGames"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { gameMode, gameModes } from '@/utils/game-mode'
import { ElMessage } from 'element-plus'

const games = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const statusFilter = ref('')
const modeFilter = ref('')
let listRequest = 0

function statusTagType(status) {
  const map = { playing: 'success', finished: 'info', waiting: 'warning' }
  return map[status] || ''
}

function statusLabel(status) {
  const map = { playing: '进行中', finished: '已结束', waiting: '等待中' }
  return map[status] || status
}

function onFilterChange() {
  page.value = 1
  fetchGames()
}

async function fetchGames() {
  const revision = ++listRequest
  loading.value = true
  try {
    const res = await request.get('/api/admin/games', {
      params: { page: page.value, limit: limit.value, status: statusFilter.value || undefined, mode: modeFilter.value || undefined }
    })
    if (revision !== listRequest) return
    if (res.data.code !== 0) throw new Error('列表加载失败')
    games.value = res.data.data.records || []
    total.value = res.data.data.total || 0
  } catch (err) {
    if (revision !== listRequest) return
    games.value = []
    total.value = 0
    ElMessage.error('获取对局列表失败')
  } finally {
    if (revision === listRequest) loading.value = false
  }
}

onMounted(() => {
  fetchGames()
})
</script>

<style scoped>
.detail-link { color: #91461c; text-underline-offset: 3px; }
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

:deep(.clickable-row) {
  cursor: pointer;
}
</style>
