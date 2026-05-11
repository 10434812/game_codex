<template>
  <div class="item-list-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>道具管理</span>
          <el-button type="primary" @click="openAddDialog">
            <el-icon><Plus /></el-icon>
            添加道具
          </el-button>
        </div>
      </template>

      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="名称" width="150" />
        <el-table-column prop="category" label="类别" width="100" />
        <el-table-column prop="price" label="价格" width="100" />
        <el-table-column label="稀有度" width="100">
          <template #default="{ row }">
            <el-tag
              :type="rarityTagType(row.rarity)"
              size="small"
            >
              {{ row.rarity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="theme" label="主题" width="120" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-popconfirm
              title="确定删除该道具吗？"
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
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑道具' : '添加道具'" width="540px">
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="类别" prop="category">
          <el-select v-model="form.category" placeholder="请选择类别">
            <el-option label="皮肤" value="skin" />
            <el-option label="宠物" value="pet" />
            <el-option label="特效" value="effect" />
            <el-option label="头像框" value="avatar_frame" />
            <el-option label="称号" value="title" />
            <el-option label="福袋" value="lucky_bag" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格" prop="price">
          <el-input-number v-model="form.price" :min="0" />
        </el-form-item>
        <el-form-item label="稀有度" prop="rarity">
          <el-select v-model="form.rarity" placeholder="请选择稀有度">
            <el-option label="普通" value="common" />
            <el-option label="稀有" value="rare" />
            <el-option label="史诗" value="epic" />
            <el-option label="传说" value="legendary" />
          </el-select>
        </el-form-item>
        <el-form-item label="主题" prop="theme">
          <el-input v-model="form.theme" />
        </el-form-item>
        <el-form-item label="图片URL" prop="imageUrl">
          <el-input v-model="form.imageUrl" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" />
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
import { ElMessage } from 'element-plus'

const items = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const isEdit = ref(false)
const editingId = ref(null)
const formRef = ref(null)

const form = reactive({
  name: '',
  category: '',
  price: 0,
  rarity: '',
  theme: '',
  imageUrl: '',
  description: ''
})

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择类别', trigger: 'change' }],
  rarity: [{ required: true, message: '请选择稀有度', trigger: 'change' }]
}

function rarityTagType(rarity) {
  const map = { common: '', rare: 'warning', epic: 'danger', legendary: 'danger' }
  return map[rarity] || ''
}

async function fetchItems() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/items')
    if (res.data.code === 0) {
      items.value = res.data.data || []
    }
  } catch (err) {
    ElMessage.error('获取道具列表失败')
  } finally {
    loading.value = false
  }
}

function openAddDialog() {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    name: '',
    category: '',
    price: 0,
    rarity: '',
    theme: '',
    imageUrl: '',
    description: ''
  })
  dialogVisible.value = true
}

function openEditDialog(row) {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    category: row.category,
    price: row.price,
    rarity: row.rarity,
    theme: row.theme || '',
    imageUrl: row.imageUrl || '',
    description: row.description || ''
  })
  dialogVisible.value = true
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    if (isEdit.value) {
      await request.put(`/api/admin/items/${editingId.value}`, form)
      ElMessage.success('道具已更新')
    } else {
      await request.post('/api/admin/items', form)
      ElMessage.success('道具已创建')
    }
    dialogVisible.value = false
    fetchItems()
  } catch (err) {
    ElMessage.error(isEdit.value ? '更新失败' : '创建失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await request.delete(`/api/admin/items/${row.id}`)
    ElMessage.success('道具已删除')
    fetchItems()
  } catch (err) {
    ElMessage.error('删除失败')
  }
}

onMounted(() => {
  fetchItems()
})
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
