<template>
  <div class="game-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>对局监控</span>
          <div class="header-actions">
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 140px" @change="fetchGames">
              <el-option label="全部" value="" />
              <el-option label="进行中" value="playing" />
              <el-option label="已结束" value="finished" />
              <el-option label="等待中" value="waiting" />
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
        <el-table-column prop="sessionId" label="对局ID" width="200" show-overflow-tooltip />
        <el-table-column prop="roomCode" label="房间码" width="120" />
        <el-table-column prop="scenicName" label="景区" width="100" />
        <el-table-column prop="playerCount" label="人数" width="80" />
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
            {{ row.duration ?? '--' }}
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
import { ElMessage } from 'element-plus'

const games = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const statusFilter = ref('')

function statusTagType(status) {
  const map = { playing: 'success', finished: 'info', waiting: 'warning' }
  return map[status] || ''
}

function statusLabel(status) {
  const map = { playing: '进行中', finished: '已结束', waiting: '等待中' }
  return map[status] || status
}

async function fetchGames() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/games', {
      params: { page: page.value, limit: limit.value, status: statusFilter.value || undefined }
    })
    if (res.data.code === 0) {
      games.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取对局列表失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchGames()
})
</script>

<style scoped>
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
