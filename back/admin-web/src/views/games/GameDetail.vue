<template>
  <div class="game-detail-page" v-loading="loading">
    <div class="detail-toolbar">
      <el-page-header :title="backLabel" @back="router.push({ name: backRoute })">
        <template #content><h1>对局 #{{ route.params.id }}</h1></template>
      </el-page-header>
      <el-button :icon="Refresh" :loading="loading" @click="fetchGameDetail">刷新</el-button>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />

    <template v-if="session">
      <section class="settlement-panel" aria-labelledby="settlement-title">
        <header class="settlement-heading">
          <h2 id="settlement-title">结算情况</h2>
          <el-tag :type="settlementView.type" effect="light">{{ settlementView.label }}</el-tag>
        </header>
        <dl class="settlement-metrics">
          <div><dt>真人</dt><dd>{{ settlement.humanCount ?? '—' }}</dd></div>
          <div><dt>机器人</dt><dd>{{ settlement.botCount ?? '—' }}</dd></div>
          <div><dt>发放金币</dt><dd>{{ settlement.totalCoins?.toLocaleString('zh-CN') ?? '—' }}</dd></div>
          <div><dt>结束时间</dt><dd>{{ session.finishedAt || '—' }}</dd></div>
        </dl>
        <p v-if="settlement.reason || settlementView.note" class="muted-text">{{ settlement.reason || settlementView.note }}</p>
      </section>

      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="roster-heading">
            <h2>参赛名单</h2>
            <el-select v-model="playerType" aria-label="参赛类型筛选" style="width: 130px">
              <el-option label="全部参赛者" value="all" />
              <el-option label="仅真人" value="humans" />
              <el-option label="仅机器人" value="bots" />
            </el-select>
          </div>
        </template>
        <p v-if="settlement.botCount == null" class="roster-note muted-text">本场暂无机器人阵容记录。</p>
        <el-table :data="visiblePlayers" :empty-text="playerType === 'bots' && settlement.botCount == null ? '暂无机器人阵容记录' : '该类型暂无参赛者'" stripe>
          <el-table-column label="排名" width="68">
            <template #default="{ row }">{{ row.rank ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="参赛者" min-width="152" show-overflow-tooltip>
            <template #default="{ row }">
              <div class="player-name">
                <el-avatar v-if="row.avatarUrl" :src="row.avatarUrl" :size="26" />
                <span>{{ row.nickname || (row.uid ? `用户 ${row.uid}` : '—') }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="88">
            <template #default="{ row }">
              <el-tag :type="row.isBot ? 'warning' : 'success'" size="small">{{ row.isBot ? '机器人' : '真人' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="积分" width="76">
            <template #default="{ row }">{{ row.score ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="实发金币" width="96">
            <template #default="{ row }">{{ row.coinsEarned ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="用户 ID" width="85">
            <template #default="{ row }">{{ row.uid ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="队伍" min-width="90">
            <template #default="{ row }">{{ row.teamId || '—' }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="section-card">
        <template #header><h2>对局信息</h2></template>
        <dl class="session-metadata">
          <div><dt>对局来源</dt><dd>{{ gameMode(session.mode).label }}</dd></div>
          <div><dt>房间码</dt><dd>{{ session.roomCode || '—' }}</dd></div>
          <div><dt>景区</dt><dd>{{ session.scenicName || '—' }}</dd></div>
          <div><dt>开始时间</dt><dd>{{ session.startedAt || '—' }}</dd></div>
          <div><dt>设定时长</dt><dd>{{ session.duration == null ? '—' : `${session.duration} 秒` }}</dd></div>
        </dl>
      </el-card>

      <el-card v-if="rounds.length" shadow="never" class="section-card">
        <template #header><h2>对局事件</h2></template>
        <el-table :data="rounds" size="small">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-for="(event, idx) in row.events" :key="idx" class="event-item">
                <el-tag size="small">{{ event.type }}</el-tag><span>{{ event.description }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="stage" label="回合" min-width="100" />
          <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { gameMode } from '@/utils/game-mode'
import request from '@/utils/request'

const settlementViews = {
  awaiting_start: { label: '等待开局确认', type: 'warning' },
  pending: { label: '待结算', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  interrupted: { label: '中断未发奖', type: 'danger' },
  unrecorded: { label: '结算结果未记录', type: 'info', note: '本场已结束，暂无可核对的结算结果。' }
}

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const detail = ref(null)
const playerType = ref('all')
let requestRevision = 0

const backRoute = computed(() => route.query.from === 'rooms' ? 'RoomList' : 'GameList')
const backLabel = computed(() => backRoute.value === 'RoomList' ? '房间管理' : '对局监控')
const session = computed(() => detail.value?.session)
const rounds = computed(() => detail.value?.rounds || [])
const settlement = computed(() => detail.value?.settlement || {})
const settlementView = computed(() => settlementViews[settlement.value.status] || settlementViews.unrecorded)
const visiblePlayers = computed(() => {
  const players = detail.value?.players || []
  if (playerType.value === 'all') return players
  return players.filter((player) => player.isBot === (playerType.value === 'bots'))
})

async function fetchGameDetail() {
  const revision = ++requestRevision
  loading.value = true
  error.value = ''
  try {
    const response = await request.get(`/api/admin/games/${encodeURIComponent(route.params.id)}`)
    if (revision !== requestRevision) return
    if (response.data.code !== 0) throw new Error('详情加载失败')
    detail.value = response.data.data
  } catch (err) {
    if (revision !== requestRevision) return
    error.value = err.response?.status === 404 ? '此对局不存在。' : '对局详情加载失败，请刷新重试。'
  } finally {
    if (revision === requestRevision) loading.value = false
  }
}

watch(() => route.params.id, () => {
  detail.value = null
  playerType.value = 'all'
  fetchGameDetail()
}, { immediate: true })
</script>

<style scoped>
.detail-toolbar, .settlement-heading, .roster-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.detail-toolbar :deep(.el-page-header) { margin: 0; }
h1 { margin: 0; font-size: 20px; }
h2 { margin: 0; font-size: 16px; }
.game-detail-page > .el-alert, .settlement-panel { margin-top: 16px; }
.settlement-panel { padding: 16px 18px; background: #fff5e6; border: 1px solid #e8d9c6; border-radius: 12px; }
.settlement-heading { padding-bottom: 12px; border-bottom: 1px solid #e8d9c6; }
.settlement-metrics, .session-metadata { display: flex; flex-wrap: wrap; gap: 14px 26px; margin: 14px 0 0; }
.settlement-metrics > div, .session-metadata > div { min-width: 95px; }
.session-metadata { margin: 0; }
dt { color: #684d3c; font-size: 13px; }
dd { margin: 4px 0 0; font-variant-numeric: tabular-nums; }
.settlement-metrics dd { font-size: 17px; font-weight: 720; }
.roster-note { margin: 0 0 10px; }
.player-name, .event-item { display: flex; align-items: center; gap: 8px; }
.player-name .el-avatar { flex-shrink: 0; }
.player-name span:last-child { overflow: hidden; text-overflow: ellipsis; }
.event-item { padding: 4px 0; }
.event-item .el-tag { flex-shrink: 0; }
</style>
