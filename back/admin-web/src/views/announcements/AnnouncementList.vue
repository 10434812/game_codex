<template>
  <div class="announcement-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>公告管理</span>
          <el-button type="primary" @click="openCreateDialog">
            <el-icon><Plus /></el-icon>
            发布公告
          </el-button>
        </div>
      </template>

      <div class="filter-bar">
        <el-radio-group v-model="statusFilter" @change="fetchAnnouncements">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="draft">草稿</el-radio-button>
          <el-radio-button label="published">已发布</el-radio-button>
          <el-radio-button label="archived">已归档</el-radio-button>
        </el-radio-group>

        <el-select
          v-model="typeFilter"
          placeholder="公告类型"
          clearable
          style="width: 160px"
          @change="fetchAnnouncements"
        >
          <el-option label="全部类型" value="" />
          <el-option label="系统公告" value="system" />
          <el-option label="活动公告" value="event" />
          <el-option label="维护公告" value="maintenance" />
          <el-option label="奖励公告" value="reward" />
        </el-select>
      </div>

      <el-table :data="announcements" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="typeTagType(row.type)" size="small" effect="plain">
              {{ typeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="100">
          <template #default="{ row }">
            <el-tag :type="priorityTagType(row.priority)" size="small" effect="dark">
              {{ priorityLabel(row.priority) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdBy" label="创建人" width="120" />
        <el-table-column prop="publishedAt" label="发布时间" width="170" />
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button
              v-if="row.status === 'draft'"
              link
              type="success"
              size="small"
              @click="handlePublish(row)"
            >
              发布
            </el-button>
            <el-button
              v-if="row.status === 'published'"
              link
              type="warning"
              size="small"
              @click="handleArchive(row)"
            >
              归档
            </el-button>
            <el-popconfirm
              title="确定删除此公告吗？"
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
          @current-change="fetchAnnouncements"
        />
      </div>
    </el-card>

    <!-- Create/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑公告' : '发布公告'"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="100px">
        <el-form-item label="公告标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入公告标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="公告类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%">
            <el-option label="系统公告" value="system" />
            <el-option label="活动公告" value="event" />
            <el-option label="维护公告" value="maintenance" />
            <el-option label="奖励公告" value="reward" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-select v-model="form.priority" placeholder="请选择优先级" style="width: 100%">
            <el-option label="低" value="low" />
            <el-option label="普通" value="normal" />
            <el-option label="高" value="high" />
            <el-option label="紧急" value="urgent" />
          </el-select>
        </el-form-item>
        <el-form-item label="公告内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            placeholder="请输入公告内容"
            maxlength="5000"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="发布方式">
          <el-radio-group v-model="publishMode">
            <el-radio :value="false">保存为草稿</el-radio>
            <el-radio :value="true">立即发布</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">
          {{ isEdit ? '更新' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'

const announcements = ref([])
const loading = ref(false)
const page = ref(1)
const limit = ref(15)
const total = ref(0)
const statusFilter = ref('')
const typeFilter = ref('')
const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const editingId = ref(null)
const formRef = ref(null)
const publishMode = ref(false)

const form = reactive({
  title: '',
  type: '',
  priority: 'normal',
  content: ''
})

const formRules = {
  title: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  type: [{ required: true, message: '请选择公告类型', trigger: 'change' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
  content: [{ required: true, message: '请输入公告内容', trigger: 'blur' }]
}

function typeTagType(type) {
  const map = { system: 'primary', event: 'warning', maintenance: 'danger', reward: 'success' }
  return map[type] || ''
}

function typeLabel(type) {
  const map = { system: '系统公告', event: '活动公告', maintenance: '维护公告', reward: '奖励公告' }
  return map[type] || type
}

function priorityTagType(priority) {
  const map = { low: 'info', normal: '', high: 'warning', urgent: 'danger' }
  return map[priority] || ''
}

function priorityLabel(priority) {
  const map = { low: '低', normal: '普通', high: '高', urgent: '紧急' }
  return map[priority] || priority
}

function statusTagType(status) {
  const map = { draft: 'info', published: 'success', archived: 'warning' }
  return map[status] || ''
}

function statusLabel(status) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档' }
  return map[status] || status
}

async function fetchAnnouncements() {
  loading.value = true
  try {
    const params = { page: page.value, limit: limit.value }
    if (statusFilter.value) params.status = statusFilter.value
    if (typeFilter.value) params.type = typeFilter.value
    const res = await request.get('/api/admin/announcements', { params })
    if (res.data.code === 0) {
      announcements.value = res.data.data.records || []
      total.value = res.data.data.total || 0
    }
  } catch (err) {
    ElMessage.error('获取公告列表失败')
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  isEdit.value = false
  editingId.value = null
  publishMode.value = false
  form.title = ''
  form.type = ''
  form.priority = 'normal'
  form.content = ''
  if (formRef.value) formRef.value.resetFields()
  dialogVisible.value = true
}

function openEditDialog(row) {
  isEdit.value = true
  editingId.value = row.id
  publishMode.value = false
  form.title = row.title
  form.type = row.type
  form.priority = row.priority || 'normal'
  form.content = row.content || ''
  dialogVisible.value = true
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const payload = {
      title: form.title,
      type: form.type,
      priority: form.priority,
      content: form.content,
      status: publishMode.value ? 'published' : 'draft'
    }
    if (isEdit.value) {
      await request.put(`/api/admin/announcements/${editingId.value}`, payload)
      ElMessage.success('公告已更新')
    } else {
      await request.post('/api/admin/announcements', payload)
      ElMessage.success('公告已创建')
    }
    dialogVisible.value = false
    fetchAnnouncements()
  } catch (err) {
    ElMessage.error(isEdit.value ? '更新失败' : '创建失败')
  } finally {
    saving.value = false
  }
}

async function handlePublish(row) {
  try {
    await ElMessageBox.confirm(`确定要发布公告「${row.title}」吗？`, '提示', { type: 'info' })
    await request.put(`/api/admin/announcements/${row.id}/publish`)
    ElMessage.success('公告已发布')
    fetchAnnouncements()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('发布失败')
    }
  }
}

async function handleArchive(row) {
  try {
    await ElMessageBox.confirm(`确定要归档公告「${row.title}」吗？`, '提示', { type: 'warning' })
    await request.put(`/api/admin/announcements/${row.id}/archive`)
    ElMessage.success('公告已归档')
    fetchAnnouncements()
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('归档失败')
    }
  }
}

async function handleDelete(row) {
  try {
    await request.delete(`/api/admin/announcements/${row.id}`)
    ElMessage.success('公告已删除')
    fetchAnnouncements()
  } catch (err) {
    ElMessage.error('删除失败')
  }
}

onMounted(() => {
  fetchAnnouncements()
})
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
