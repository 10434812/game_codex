<template>
  <el-card shadow="never" class="retention-panel" v-loading="loading">
    <template #header>
      <div class="panel-heading"><h2>留存与开局转化</h2><el-button :loading="loading" @click="refresh">刷新埋点数据</el-button></div>
    </template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template v-else>
      <p class="data-note">{{ data.note || '从接入埋点之日起累计；暂无记录时显示空表。' }}</p>
      <p class="table-scroll-note">左右滑动表格，查看新增设备和 7 日留存。</p>
      <h3>近 14 天活跃与新增</h3>
      <el-table :data="data.daily" empty-text="还没有启动事件，请先体验游戏" stripe>
        <el-table-column prop="date" label="日期" min-width="120" />
        <el-table-column prop="devices" label="活跃设备" min-width="100" />
        <el-table-column prop="accounts" label="活跃账号" min-width="100" />
        <el-table-column prop="newDevices" label="首次记录设备" min-width="130" />
      </el-table>
      <h3>新增设备留存</h3>
      <el-table :data="data.retention" empty-text="暂无新增设备记录" stripe>
        <el-table-column prop="date" label="首次启动日" min-width="120" />
        <el-table-column prop="devices" label="新增设备" min-width="100" />
        <el-table-column v-for="day in [1, 3, 7]" :key="day" :label="`${day} 日留存`" min-width="115">
          <template #default="{row}">{{ retentionRate(row, day) }}</template>
        </el-table-column>
      </el-table>
      <h3>近 7 天首次体验漏斗</h3>
      <p class="data-note">按设备逐步统计：下一步必须发生在上一步之后。已授权的老用户不会重复进入授权步骤。</p>
      <el-table :data="data.funnel" empty-text="暂无完整体验事件" stripe>
        <el-table-column label="步骤" min-width="140"><template #default="{row}">{{ labels[row.name] || row.name }}</template></el-table-column>
        <el-table-column prop="devices" label="设备数" min-width="100" />
      </el-table>
      <p class="completion">近 7 天对局完成率：<strong>{{ completionRate }}</strong>（{{ data.completion?.finishes || 0 }} / {{ data.completion?.starts || 0 }}）</p>
      <p class="data-note">按同一设备、同一场次的开始和结算事件关联，重复上报不重复计数；这是客户端完局率，服务端结算记录单独保留。</p>
      <h3>近 7 天快速匹配</h3>
      <el-table :data="data.matchmaking || []" empty-text="暂无新版匹配事件，发布客户端后开始积累" stripe>
        <el-table-column label="客户端" min-width="100"><template #default="{row}">{{ clientName(row.client) }}</template></el-table-column>
        <el-table-column prop="requests" label="匹配请求" min-width="100" />
        <el-table-column prop="started" label="实际开局" min-width="100" />
        <el-table-column label="平均排队" min-width="110"><template #default="{row}">{{ seconds(row.averageWaitMs) }}</template></el-table-column>
        <el-table-column prop="cancelled" label="主动取消/失效" min-width="130" />
        <el-table-column prop="failed" label="请求失败" min-width="100" />
        <el-table-column prop="background" label="曾切后台" min-width="100" />
        <el-table-column prop="allHumanStarts" label="全真人开局" min-width="120" />
        <el-table-column label="机器人席位占比" min-width="150"><template #default="{row}">{{ rate(row.botPlayers, row.totalPlayers) }}</template></el-table-column>
      </el-table>
      <p class="data-note">排队从服务器确认入队到实际开始计时；切后台单独记录，不视为取消。全真人开局与机器人补位分开统计。</p>
      <h3>匹配退出与失败原因</h3>
      <el-table :data="data.matchExits || []" empty-text="暂无退出或失败记录" stripe>
        <el-table-column label="类型" min-width="130"><template #default="{row}">{{ row.name === 'match_cancel' ? '主动取消/失效' : row.name === 'match_failed' ? '请求失败' : (row.name || '-') }}</template></el-table-column>
        <el-table-column label="原因" min-width="180"><template #default="{row}">{{ reasons[row.reason] || '其他原因' }}</template></el-table-column>
        <el-table-column prop="attempts" label="请求次数" min-width="100" />
      </el-table>
      <p class="completion">复玩后实际开局：<strong>{{ rate(data.replay?.started, data.replay?.attempts) }}</strong>（{{ data.replay?.started || 0 }} / {{ data.replay?.attempts || 0 }}）</p>
      <p class="data-note">仅计新版关联事件；点击后尚未开局的请求保留在分母中，不能据此认定玩家已经流失。</p>
      <h3>授权后启动准备耗时</h3>
      <el-table :data="data.startup || []" empty-text="暂无启动耗时样本" stripe>
        <el-table-column label="客户端" min-width="100"><template #default="{row}">{{ clientName(row.client) }}</template></el-table-column>
        <el-table-column prop="samples" label="样本数" min-width="100" />
        <el-table-column label="平均耗时" min-width="110"><template #default="{row}">{{ seconds(row.averageMs) }}</template></el-table-column>
      </el-table>
    </template>
  </el-card>
</template>
<script setup>
import {computed, onMounted, ref} from 'vue'
import request from '@/utils/request'
const data = ref({daily: [], retention: [], funnel: [], completion: null})
const loading = ref(false), error = ref('')
const labels = {app_launch: '启动', privacy_accept: '同意隐私', login_success: '登录成功', game_start: '开始对局', game_finish: '查看结算', replay_click: '再来一局'}
const reasons = {user_cancel: '玩家主动取消', room_unavailable: '房间失效', login_expired: '登录失效', forbidden: '账号权限限制', already_queued: '重复入队', rate_limited: '请求过于频繁', server_error: '服务器错误', network_error: '连接失败或响应无效'}
const clientName = (value) => value === 'minigame' ? '小游戏' : '小程序'
const seconds = (value) => value === null || value === undefined ? '--' : `${(Number(value) / 1000).toFixed(1)} 秒`
const rate = (part, total) => Number(total) > 0 ? `${(Number(part || 0) / Number(total) * 100).toFixed(1)}%` : '--'
const completionRate = computed(() => Number(data.value.completion?.starts) > 0 ? `${(Number(data.value.completion.finishes) / Number(data.value.completion.starts) * 100).toFixed(1)}%` : '--')
function retentionRate(row, day) {
  const count = row[`day${day}`]
  return count === null || count === undefined || !Number(row.devices) ? '--' : `${(Number(count) / Number(row.devices) * 100).toFixed(1)}% (${count})`
}
async function refresh() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const response = await request.get('/api/admin/stats/analytics')
    if (response.data.code !== 0) throw new Error('response_failed')
    data.value = response.data.data
  } catch (_) {error.value = '埋点数据加载失败，请点击刷新重试。'}
  finally {loading.value = false}
}
onMounted(refresh)
</script>
<style scoped>
.retention-panel { margin-bottom: 24px; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 18px; }
h3 { margin: 28px 0 12px; font-size: 15px; }
.data-note { color: var(--el-text-color-regular); font-size: 13px; line-height: 1.7; margin: 8px 0 16px; }
.table-scroll-note { display:none; }
@media (max-width:640px) { .table-scroll-note { display:block; color:var(--el-text-color-regular); font-size:12px; line-height:1.6; } }
.completion { margin: 24px 0 4px; font-variant-numeric: tabular-nums; }
</style>
