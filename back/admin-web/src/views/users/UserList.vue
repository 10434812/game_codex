<template>
  <div class="user-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <el-input
            v-model="keyword"
            placeholder="搜索昵称或ID"
            clearable
            style="width: 240px"
            @clear="fetchUsers"
            @keyup.enter="fetchUsers"
          >
            <template #append>
              <el-button @click="fetchUsers">
                <el-icon><Search /></el-icon>
              </el-button>
            </template>
          </el-input>
        </div>
      </template>

      <el-table :data="users" v-loading="loading" stripe>
        <el-table-column prop="uid" label="ID" width="80" />
        <el-table-column prop="nickname" label="昵称" width="150" />
        <el-table-column label="头像" width="80">
          <template #default="{ row }">
            <el-avatar :src="row.avatarUrl" :size="36" />
          </template>
        </el-table-column>
        <el-table-column prop="coins" label="金币" width="100" sortable />
        <el-table-column prop="level" label="等级" width="80" sortable />
        <el-table-column prop="totalGames" label="总局数" width="80" sortable />
        <el-table-column prop="totalWins" label="胜场" width="80" sortable />
        <el-table-column prop="createdAt" label="注册时间" width="170" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isBanned ? 'danger' : 'success'" size="small">
              {{ row.isBanned ? '已封禁' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="$router.push({ name: 'UserDetail', params: { id: row.uid } })">
              详情
            </el-button>
            <el-button
              link
              :type="row.isBanned ? 'success' : 'warning'"
              size="small"
              @click="handleToggleBan(row)"
            >
              {{ row.isBanned ? '解封' : '封禁' }}
            </el-button>
            <el-button link type="primary" size="small" @click="openCoinDialog(row)">
              调整金币
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="fetchUsers"
        />
      </div>
    </el-card>

    <!-- Coin Adjust Dialog -->
    <el-dialog v-model="coinDialogVisible" title="调整金币" width="400px">
      <el-form :model="coinForm" label-width="80px">
        <el-form-item label="当前金币">
          <span>{{ currentUser?.coins ?? 0 }}</span>
        </el-form-item>
        <el-form-item label="调整金额">
          <el-input-number v-model="coinForm.amount" :min="-999999" :max="999999" />
        </el-form-item>
        <el-form-item label="调整原因">
          <el-input v-model="coinForm.reason" type="textarea" placeholder="请输入原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="coinDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="coinSaving" @click="handleCoinAdjust">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'

const users = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const keyword = ref('')

const coinDialogVisible = ref(false)
const coinSaving = ref(false)
const currentUser = ref(null)
const coinForm = reactive({ amount: 0, reason: '' })

async function fetchUsers() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/users', {
      params: { page: page.value, limit: limit.value, keyword: keyword.value }
    })
    if (res.data.code === 0) {
      users.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取用户列表失败')
  } finally {
    loading.value = false
  }
}

async function handleToggleBan(row) {
  const action = row.isBanned ? '解封' : '封禁'
  try {
    await ElMessageBox.confirm(`确定要${action}用户「${row.nickname}」吗？`, '提示', {
      type: 'warning'
    })
    await request.put(`/api/admin/users/${row.uid}/ban`, {
      isBanned: !row.isBanned
    })
    ElMessage.success(`${action}成功`)
    row.isBanned = !row.isBanned
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(`${action}失败`)
    }
  }
}

function openCoinDialog(row) {
  currentUser.value = row
  coinForm.amount = 0
  coinForm.reason = ''
  coinDialogVisible.value = true
}

async function handleCoinAdjust() {
  coinSaving.value = true
  try {
    await request.put(`/api/admin/users/${currentUser.value.uid}/coins`, {
      amount: coinForm.amount,
      reason: coinForm.reason
    })
    ElMessage.success('金币调整成功')
    coinDialogVisible.value = false
    currentUser.value.coins += coinForm.amount
  } catch (err) {
    ElMessage.error('金币调整失败')
  } finally {
    coinSaving.value = false
  }
}

onMounted(() => {
  fetchUsers()
})
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
