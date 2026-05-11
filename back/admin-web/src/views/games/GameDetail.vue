<template>
  <div class="game-detail-page" v-loading="loading">
    <el-page-header @back="$router.push({ name: 'GameList' })">
      <template #content>
        <span>对局详情 - {{ session?.sessionId || '加载中...' }}</span>
      </template>
    </el-page-header>

    <el-card class="info-card" v-if="session">
      <template #header>对局信息</template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="对局ID">{{ session.sessionId }}</el-descriptions-item>
        <el-descriptions-item label="房间码">{{ session.roomCode }}</el-descriptions-item>
        <el-descriptions-item label="景区">{{ session.scenicName }}</el-descriptions-item>
        <el-descriptions-item label="人数">{{ session.playerCount }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="session.status === 'playing' ? 'success' : 'info'" size="small">
            {{ session.status === 'playing' ? '进行中' : '已结束' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ session.startedAt }}</el-descriptions-item>
        <el-descriptions-item label="持续时长">{{ session.duration ?? '--' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="section-card">
      <template #header>玩家排名</template>
      <el-table :data="players" size="small">
        <el-table-column type="index" label="排名" width="60" />
        <el-table-column prop="nickname" label="昵称" width="120" />
        <el-table-column prop="uid" label="UID" width="100" />
        <el-table-column label="头像" width="70">
          <template #default="{ row }">
            <el-avatar :src="row.avatarUrl" :size="32" />
          </template>
        </el-table-column>
        <el-table-column prop="teamId" label="队伍" width="60" />
        <el-table-column prop="score" label="积分" width="80" sortable />
        <el-table-column prop="isBot" label="类型" width="70">
          <template #default="{ row }">
            <el-tag :type="row.isBot ? 'warning' : ''" size="small">
              {{ row.isBot ? '机器人' : '玩家' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="section-card">
      <template #header>回合记录</template>
      <el-table :data="rounds" size="small">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="round-events">
              <div v-for="(event, idx) in row.events" :key="idx" class="event-item">
                <el-tag size="small" class="event-tag">{{ event.type }}</el-tag>
                <span>{{ event.description }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="回合" width="80">
          <template #default="{ $index }">第{{ $index + 1 }}回合</template>
        </el-table-column>
        <el-table-column prop="stage" label="阶段" width="100" />
        <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
      </el-table>
      <el-empty v-if="!rounds.length" description="暂无回合记录" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'

const route = useRoute()

const loading = ref(true)
const session = ref(null)
const players = ref([])
const rounds = ref([])

async function fetchGameDetail() {
  loading.value = true
  try {
    const res = await request.get(`/api/admin/games/${route.params.id}`)
    if (res.data.code === 0) {
      const data = res.data.data
      session.value = data.session
      players.value = data.players || []
      rounds.value = data.rounds || []
    }
  } catch (err) {
    console.error('Failed to fetch game detail:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchGameDetail()
})
</script>

<style scoped>
.info-card {
  margin-top: 16px;
}

.section-card {
  margin-top: 16px;
}

.round-events {
  padding: 8px 0;
}

.event-item {
  padding: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.event-tag {
  flex-shrink: 0;
}
</style>
