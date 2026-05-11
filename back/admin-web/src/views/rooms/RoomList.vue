<template>
  <div class="room-list-page">
    <!-- Stats Cards -->
    <div class="stat-cards">
      <el-card class="stat-card" shadow="hover">
        <div class="stat-card-content">
          <div class="stat-info">
            <div class="stat-label">等待中</div>
            <div class="stat-value">{{ stats.waiting ?? 0 }}</div>
          </div>
          <el-icon class="stat-icon" :size="40" color="#e6a23c"><Clock /></el-icon>
        </div>
      </el-card>
      <el-card class="stat-card" shadow="hover">
        <div class="stat-card-content">
          <div class="stat-info">
            <div class="stat-label">进行中</div>
            <div class="stat-value">{{ stats.playing ?? 0 }}</div>
          </div>
          <el-icon class="stat-icon" :size="40" color="#67c23a"><VideoPlay /></el-icon>
        </div>
      </el-card>
      <el-card class="stat-card" shadow="hover">
        <div class="stat-card-content">
          <div class="stat-info">
            <div class="stat-label">已结束</div>
            <div class="stat-value">{{ stats.finished ?? 0 }}</div>
          </div>
          <el-icon class="stat-icon" :size="40" color="#909399"><Finished /></el-icon>
        </div>
      </el-card>
    </div>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>房间管理</span>
          <div class="header-actions">
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 140px" @change="fetchRooms">
              <el-option label="全部" value="" />
              <el-option label="等待中" value="waiting" />
              <el-option label="进行中" value="playing" />
              <el-option label="已结束" value="finished" />
            </el-select>
            <el-button @click="fetchRooms">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <el-table
        :data="rooms"
        v-loading="loading"
        stripe
        @row-click="openDetailDialog"
        row-class-name="clickable-row"
      >
        <el-table-column prop="id" label="房间ID" width="80" />
        <el-table-column prop="roomCode" label="房间码" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="playerCount" label="玩家人数" width="100" />
        <el-table-column prop="hostName" label="房主" width="120" show-overflow-tooltip />
        <el-table-column prop="scenicName" label="景区" width="100" />
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="120" fixed="right" @click.stop>
          <template #default="{ row }">
            <el-popconfirm
              v-if="row.status === 'playing'"
              title="确定强制关闭该房间吗？"
              confirm-button-text="关闭"
              @confirm="handleForceClose(row)"
            >
              <template #reference>
                <el-button
                  link
                  type="danger"
                  size="small"
                  @click.stop
                >
                  强制关闭
                </el-button>
              </template>
            </el-popconfirm>
            <span v-else class="no-action">--</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="fetchRooms"
        />
      </div>
    </el-card>

    <!-- Room Detail Dialog -->
    <el-dialog v-model="detailDialogVisible" :title="'房间详情 - ' + (currentRoom?.roomCode || '')" width="680px">
      <template v-if="currentRoom">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="房间ID">{{ currentRoom.id }}</el-descriptions-item>
          <el-descriptions-item label="房间码">{{ currentRoom.roomCode }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(currentRoom.status)" size="small">
              {{ statusLabel(currentRoom.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="景区">{{ currentRoom.scenicName }}</el-descriptions-item>
          <el-descriptions-item label="房主">{{ currentRoom.hostName }}</el-descriptions-item>
          <el-descriptions-item label="玩家人数">{{ currentRoom.playerCount }}</el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{ currentRoom.createdAt }}</el-descriptions-item>
        </el-descriptions>

        <div class="player-section">
          <h4 class="player-title">玩家列表</h4>
          <el-table :data="currentRoom.players || []" stripe size="small">
            <el-table-column prop="uid" label="用户ID" width="80" />
            <el-table-column prop="nickname" label="昵称" width="150" />
            <el-table-column label="头像" width="70">
              <template #default="{ row }">
                <el-avatar :src="row.avatarUrl" :size="32" />
              </template>
            </el-table-column>
            <el-table-column prop="team" label="队伍" width="80">
              <template #default="{ row }">
                <el-tag :type="row.team === 1 ? 'primary' : 'success'" size="small">
                  {{ row.team === 1 ? '红队' : '蓝队' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="score" label="得分" width="80" />
          </el-table>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh, Clock, VideoPlay, Finished } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const rooms = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const statusFilter = ref('')
const stats = ref({ waiting: 0, playing: 0, finished: 0 })

// Detail dialog
const detailDialogVisible = ref(false)
const currentRoom = ref(null)

function statusTagType(status) {
  const map = { playing: 'success', finished: 'info', waiting: 'warning' }
  return map[status] || ''
}

function statusLabel(status) {
  const map = { playing: '进行中', finished: '已结束', waiting: '等待中' }
  return map[status] || status
}

async function fetchStats() {
  try {
    const res = await request.get('/api/admin/rooms/stats')
    if (res.data.code === 0) {
      stats.value = res.data.data || { waiting: 0, playing: 0, finished: 0 }
    }
  } catch (err) {
    // Silently fail for stats
  }
}

async function fetchRooms() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/rooms', {
      params: { page: page.value, limit: limit.value, status: statusFilter.value || undefined }
    })
    if (res.data.code === 0) {
      rooms.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取房间列表失败')
  } finally {
    loading.value = false
  }
}

async function openDetailDialog(row) {
  try {
    const res = await request.get(`/api/admin/rooms/${row.id}`)
    if (res.data.code === 0) {
      currentRoom.value = res.data.data || row
      detailDialogVisible.value = true
    }
  } catch (err) {
    ElMessage.error('获取房间详情失败')
  }
}

async function handleForceClose(row) {
  try {
    await request.put(`/api/admin/rooms/${row.id}/close`)
    ElMessage.success('房间已强制关闭')
    fetchRooms()
    fetchStats()
  } catch (err) {
    ElMessage.error('强制关闭房间失败')
  }
}

onMounted(() => {
  fetchStats()
  fetchRooms()
})
</script>

<style scoped>
.stat-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
}

.stat-card-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 28px;
  font-weight: bold;
  color: #303133;
}

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

.player-section {
  margin-top: 20px;
}

.player-title {
  margin: 0 0 12px;
  font-size: 15px;
  color: #303133;
}

:deep(.clickable-row) {
  cursor: pointer;
}

.no-action {
  color: #c0c4cc;
}
</style>
