<template>
  <div class="user-detail-page" v-loading="loading">
    <el-page-header @back="$router.push({ name: 'UserList' })">
      <template #content>
        <span>用户详情 - {{ user?.nickname || '加载中...' }}</span>
      </template>
    </el-page-header>

    <el-card class="info-card" v-if="user">
      <template #header>基本信息</template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="用户ID">{{ user.uid }}</el-descriptions-item>
        <el-descriptions-item label="昵称">
          <el-avatar :src="user.avatarUrl" :size="24" class="avatar-inline" />
          {{ user.nickname }}
        </el-descriptions-item>
        <el-descriptions-item label="等级">{{ user.level }}</el-descriptions-item>
        <el-descriptions-item label="金币">{{ user.coins }}</el-descriptions-item>
        <el-descriptions-item label="总局数">{{ user.totalGames }}</el-descriptions-item>
        <el-descriptions-item label="胜场">{{ user.totalWins }}</el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ user.createdAt }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="user.isBanned ? 'danger' : 'success'" size="small">
            {{ user.isBanned ? '已封禁' : '正常' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="section-card">
      <template #header>拥有道具</template>
      <el-table :data="items" size="small">
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="category" label="类别" />
        <el-table-column prop="rarity" label="稀有度" />
        <el-table-column prop="acquiredAt" label="获取时间" width="170" />
      </el-table>
      <el-empty v-if="!items.length" description="暂无道具" />
    </el-card>

    <el-card class="section-card">
      <template #header>最近对局</template>
      <el-table :data="games" size="small">
        <el-table-column prop="sessionId" label="对局ID" width="200" />
        <el-table-column prop="scenicName" label="景区" />
        <el-table-column prop="rank" label="排名" width="80" />
        <el-table-column prop="score" label="积分" width="80" />
        <el-table-column prop="playedAt" label="时间" width="170" />
      </el-table>
      <el-empty v-if="!games.length" description="暂无对局记录" />
    </el-card>

    <el-card class="section-card">
      <template #header>金币变动记录</template>
      <el-table :data="coinRecords" size="small">
        <el-table-column prop="amount" label="变动金额" width="120">
          <template #default="{ row }">
            <span :style="{ color: row.amount > 0 ? '#67c23a' : '#f56c6c' }">
              {{ row.amount > 0 ? '+' : '' }}{{ row.amount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" />
        <el-table-column prop="createdAt" label="时间" width="170" />
      </el-table>
      <el-empty v-if="!coinRecords.length" description="暂无记录" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'

const route = useRoute()

const loading = ref(true)
const user = ref(null)
const items = ref([])
const games = ref([])
const coinRecords = ref([])

async function fetchUserDetail() {
  loading.value = true
  try {
    const res = await request.get(`/api/admin/users/${route.params.id}`)
    if (res.data.code === 0) {
      const data = res.data.data
      user.value = data.user
      items.value = data.items || []
      games.value = data.games || []
      coinRecords.value = data.coinRecords || []
    }
  } catch (err) {
    console.error('Failed to fetch user detail:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchUserDetail()
})
</script>

<style scoped>
.info-card {
  margin-top: 16px;
}

.avatar-inline {
  vertical-align: middle;
  margin-right: 6px;
}

.section-card {
  margin-top: 16px;
}
</style>
