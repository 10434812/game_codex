<template>
  <div class="system-config-page">
    <el-card class="batch-bar-card">
      <template #header>
        <div class="card-header">
          <span>系统配置</span>
          <div class="batch-actions">
            <el-button
              type="primary"
              :disabled="!hasDirty"
              :loading="batchSaving"
              @click="handleBatchSave"
            >
              批量保存
            </el-button>
            <el-badge :value="dirtyCount" :hidden="!hasDirty" type="danger" class="dirty-badge">
              <span>待保存</span>
            </el-badge>
          </div>
        </div>
      </template>
      <p class="config-hint">修改配置后点击行尾的「保存」按钮单独保存，或使用「批量保存」保存所有修改。</p>
    </el-card>

    <el-card
      v-for="group in configGroups"
      :key="group.prefix"
      class="config-group-card"
    >
      <template #header>
        <div class="card-header group-header">
          <span>{{ group.label }}</span>
          <el-tag size="small" type="info">{{ group.items.length }} 项</el-tag>
        </div>
      </template>

      <div class="config-table-wrapper">
        <table class="config-table">
          <thead>
            <tr>
              <th class="col-key">配置键</th>
              <th class="col-desc">说明</th>
              <th class="col-value">当前值</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="cfg in group.items"
              :key="cfg.key"
              :class="{ 'row-dirty': cfg.isDirty }"
            >
              <td class="col-key">
                <code class="config-key">{{ cfg.key }}</code>
              </td>
              <td class="col-desc">{{ cfg.description }}</td>
              <td class="col-value">
                <el-switch
                  v-if="cfg.valueType === 'boolean'"
                  v-model="cfg.typedValue"
                  active-text="开启"
                  inactive-text="关闭"
                  @change="onConfigChange(cfg)"
                />
                <el-input-number
                  v-else-if="cfg.valueType === 'number'"
                  v-model="cfg.typedValue"
                  :min="0"
                  :max="999999"
                  size="small"
                  style="width: 160px"
                  @change="onConfigChange(cfg)"
                />
                <el-input
                  v-else-if="cfg.valueType === 'textarea'"
                  v-model="cfg.typedValue"
                  type="textarea"
                  :rows="2"
                  size="small"
                  style="width: 100%"
                  @input="onConfigChange(cfg)"
                />
                <el-input
                  v-else
                  v-model="cfg.typedValue"
                  size="small"
                  style="width: 240px"
                  @input="onConfigChange(cfg)"
                />
              </td>
              <td class="col-actions">
                <el-button
                  type="primary"
                  size="small"
                  :loading="cfg.saving"
                  :disabled="!cfg.isDirty"
                  @click="handleSaveSingle(cfg)"
                >
                  保存
                </el-button>
                <el-button
                  size="small"
                  :disabled="!cfg.isDirty"
                  @click="handleReset(cfg)"
                >
                  重置
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const configs = ref([])
const loading = ref(false)
const batchSaving = ref(false)

const groupedPrefixes = [
  { prefix: 'game', label: '游戏配置' },
  { prefix: 'shop', label: '商城配置' },
  { prefix: 'system', label: '系统配置' }
]

function detectValueType(cfg) {
  if (cfg.value === 'true' || cfg.value === 'false') return 'boolean'
  if (cfg.key.includes('message')) return 'textarea'
  if (cfg.value !== '' && !isNaN(Number(cfg.value))) return 'number'
  return 'text'
}

function parseTypedValue(cfg) {
  if (cfg.valueType === 'boolean') return cfg.value === 'true'
  if (cfg.valueType === 'number') return Number(cfg.value)
  return cfg.value
}

function stringifyTypedValue(cfg) {
  if (cfg.valueType === 'boolean') return cfg.typedValue ? 'true' : 'false'
  if (cfg.valueType === 'number') return String(cfg.typedValue)
  return cfg.typedValue
}

const configGroups = computed(() => {
  return groupedPrefixes.map(g => {
    const items = configs.value
      .filter(c => c.key.startsWith(g.prefix + '.'))
      .map(c => ({
        ...c,
        typedValue: parseTypedValue(c),
        // isDirty & originalTypedValue set during init
      }))
    return { ...g, items }
  })
})

// Track original values for dirty comparison
const originalValuesMap = new Map()

function initConfigs(rawList) {
  // Build flat config list with enriched metadata
  const list = []
  for (const raw of rawList) {
    const key = raw.key
    const valueType = detectValueType(raw)
    const typedValue = parseTypedValue({ ...raw, valueType })
    originalValuesMap.set(key, typedValue)

    list.push({
      key: raw.key,
      value: raw.value,
      typedValue,
      description: raw.description || '',
      defaultValue: raw.defaultValue !== undefined ? raw.defaultValue : raw.value,
      valueType,
      isDirty: false,
      saving: false,
      prefix: key.split('.')[0]
    })
  }
  return list
}

function onConfigChange(cfg) {
  const original = originalValuesMap.get(cfg.key)
  cfg.isDirty = cfg.typedValue !== original
}

const hasDirty = computed(() => {
  return configs.value.some(c => c.isDirty)
})

const dirtyCount = computed(() => {
  return configs.value.filter(c => c.isDirty).length
})

async function fetchConfigs() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/configs')
    if (res.data.code === 0) {
      const rawList = res.data.data || []
      originalValuesMap.clear()
      configs.value = initConfigs(rawList)
    }
  } catch (err) {
    ElMessage.error('获取配置失败')
  } finally {
    loading.value = false
  }
}

async function handleSaveSingle(cfg) {
  cfg.saving = true
  try {
    await request.put('/api/admin/configs', {
      configs: [{ key: cfg.key, value: stringifyTypedValue(cfg) }]
    })
    ElMessage.success(`「${cfg.key}」已保存`)
    originalValuesMap.set(cfg.key, cfg.typedValue)
    cfg.isDirty = false
  } catch (err) {
    ElMessage.error(`保存「${cfg.key}」失败`)
  } finally {
    cfg.saving = false
  }
}

async function handleBatchSave() {
  const dirtyConfigs = configs.value.filter(c => c.isDirty)
  if (dirtyConfigs.length === 0) return

  batchSaving.value = true
  try {
    const payload = {
      configs: dirtyConfigs.map(c => ({ key: c.key, value: stringifyTypedValue(c) }))
    }
    await request.put('/api/admin/configs', payload)
    ElMessage.success(`已批量保存 ${dirtyConfigs.length} 项配置`)
    dirtyConfigs.forEach(c => {
      originalValuesMap.set(c.key, c.typedValue)
      c.isDirty = false
    })
  } catch (err) {
    ElMessage.error('批量保存失败')
  } finally {
    batchSaving.value = false
  }
}

function handleReset(cfg) {
  cfg.typedValue = originalValuesMap.get(cfg.key)
  cfg.isDirty = false
}

onMounted(() => {
  fetchConfigs()
})
</script>

<style scoped>
.batch-bar-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dirty-badge :deep(.el-badge__content) {
  position: static;
  transform: none;
  margin-left: 4px;
}

.config-hint {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.config-group-card {
  margin-bottom: 16px;
}

.group-header {
  font-weight: 600;
  font-size: 15px;
}

.config-table-wrapper {
  overflow-x: auto;
}

.config-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.config-table th {
  text-align: left;
  padding: 10px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
  color: #606266;
  font-weight: 600;
}

.config-table td {
  padding: 12px;
  border-bottom: 1px solid #ebeef5;
  vertical-align: middle;
}

.config-table tbody tr:hover {
  background: #f5f7fa;
}

.config-table tbody tr.row-dirty {
  background: #fef6ec;
}

.config-table tbody tr.row-dirty:hover {
  background: #fef0db;
}

.col-key {
  width: 260px;
}

.col-desc {
  width: 220px;
}

.col-value {
  min-width: 260px;
}

.col-actions {
  width: 180px;
  white-space: nowrap;
}

.config-key {
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 12px;
  color: #606266;
  user-select: all;
}
</style>
