<template>
  <div class="admin-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>管理员管理</span>
          <div class="header-actions">
            <el-input
              v-model="keyword"
              placeholder="搜索用户名"
              clearable
              style="width: 200px"
              @clear="fetchAdmins"
              @keyup.enter="fetchAdmins"
            >
              <template #append>
                <el-button @click="fetchAdmins">
                  <el-icon><Search /></el-icon>
                </el-button>
              </template>
            </el-input>
            <el-button type="primary" @click="openAddDialog">
              <el-icon><Plus /></el-icon>
              添加管理员
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="admins" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" width="160" />
        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="row.role === 'super' ? 'danger' : 'info'" size="small">
              {{ row.role === 'super' ? '超级管理员' : '普通管理员' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isBanned ? 'danger' : 'success'" size="small">
              {{ row.isBanned ? '已封禁' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" width="170" />
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button link type="primary" size="small" @click="openResetPasswordDialog(row)">
              重置密码
            </el-button>
            <el-popconfirm
              title="确定删除该管理员吗？"
              confirm-button-text="删除"
              @confirm="handleDelete(row)"
            >
              <template #reference>
                <el-button link type="danger" size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="limit"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="fetchAdmins"
        />
      </div>
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑管理员' : '添加管理员'" width="480px">
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" :prop="isEdit ? undefined : 'password'">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="isEdit ? '不填则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" placeholder="请选择角色">
            <el-option label="超级管理员" value="super" />
            <el-option label="普通管理员" value="normal" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- Reset Password Dialog -->
    <el-dialog v-model="resetPwdDialogVisible" title="重置密码" width="400px">
      <el-form :model="resetPwdForm" label-width="100px">
        <el-form-item label="新密码" prop="password">
          <el-input
            v-model="resetPwdForm.password"
            type="password"
            placeholder="请输入新密码"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPwdDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetPwdSaving" @click="handleResetPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const admins = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(20)
const total = ref(0)
const keyword = ref('')

// Add/Edit dialog
const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const formRef = ref(null)
const form = reactive({ username: '', password: '', role: 'normal' })
const formRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

// Reset password dialog
const resetPwdDialogVisible = ref(false)
const resetPwdSaving = ref(false)
const resetPwdAdminId = ref(null)
const resetPwdForm = reactive({ password: '' })

async function fetchAdmins() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/admins', {
      params: { page: page.value, limit: limit.value, keyword: keyword.value || undefined }
    })
    if (res.data.code === 0) {
      admins.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取管理员列表失败')
  } finally {
    loading.value = false
  }
}

function openAddDialog() {
  isEdit.value = false
  editingId.value = null
  form.username = ''
  form.password = ''
  form.role = 'normal'
  dialogVisible.value = true
}

function openEditDialog(row) {
  isEdit.value = true
  editingId.value = row.id
  form.username = row.username
  form.password = ''
  form.role = row.role
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const data = { username: form.username, role: form.role }
    if (form.password) {
      data.password = form.password
    }

    if (isEdit.value) {
      await request.put(`/api/admin/admins/${editingId.value}`, data)
      ElMessage.success('管理员更新成功')
    } else {
      data.password = form.password || '123456'
      await request.post('/api/admin/admins', data)
      ElMessage.success('管理员添加成功')
    }
    dialogVisible.value = false
    fetchAdmins()
  } catch (err) {
    ElMessage.error(isEdit.value ? '管理员更新失败' : '管理员添加失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await request.delete(`/api/admin/admins/${row.id}`)
    ElMessage.success('管理员删除成功')
    fetchAdmins()
  } catch (err) {
    ElMessage.error('管理员删除失败')
  }
}

function openResetPasswordDialog(row) {
  resetPwdAdminId.value = row.id
  resetPwdForm.password = ''
  resetPwdDialogVisible.value = true
}

async function handleResetPassword() {
  if (!resetPwdForm.password) {
    ElMessage.warning('请输入新密码')
    return
  }
  resetPwdSaving.value = true
  try {
    await request.put(`/api/admin/admins/${resetPwdAdminId.value}/password`, {
      password: resetPwdForm.password
    })
    ElMessage.success('密码重置成功')
    resetPwdDialogVisible.value = false
  } catch (err) {
    ElMessage.error('密码重置失败')
  } finally {
    resetPwdSaving.value = false
  }
}

onMounted(() => {
  fetchAdmins()
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
</style>
