<template>
  <div class="login-page">
    <!-- Decorative Elements -->
    <div class="login-bg-circles">
      <div class="circle c1"></div>
      <div class="circle c2"></div>
      <div class="circle c3"></div>
    </div>

    <el-card class="login-card" shadow="xl">
      <template #header>
        <div class="login-header">
          <div class="login-logo">
            <span class="login-logo-icon">锦</span>
          </div>
          <h2 class="login-title">锦鲤前程</h2>
          <p class="login-subtitle">管理后台 · Admin Panel</p>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="0"
        size="large"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="用户名"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            class="login-btn"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
        <div v-if="errorMsg" class="error-msg">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ errorMsg }}</span>
        </div>
      </el-form>

      <div class="login-footer">
        <span>锦鲤前程 v1.0</span>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { User, Lock, WarningFilled } from '@element-plus/icons-vue'

const router = useRouter()
const authStore = useAuthStore()

const formRef = ref(null)
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  errorMsg.value = ''

  try {
    await authStore.login(form.username, form.password)
    router.push({ name: 'Dashboard' })
  } catch (err) {
    errorMsg.value = err.response?.data?.message || '登录失败，请检查用户名和密码'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2b1e10 0%, #4a2d1a 40%, #6b4423 100%);
  position: relative;
  overflow: hidden;
}

.login-bg-circles {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  pointer-events: none;
}

.circle {
  position: absolute;
  border-radius: 50%;
  opacity: 0.06;
}

.c1 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, #e57c1f, transparent);
  top: -200px;
  right: -100px;
  animation: floatSlow 25s ease-in-out infinite;
}

.c2 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #d2a45a, transparent);
  bottom: -100px;
  left: -80px;
  animation: floatSlow 30s ease-in-out infinite reverse;
}

.c3 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, #e57c1f, transparent);
  top: 50%;
  left: 60%;
  animation: floatSlow 20s ease-in-out infinite 5s;
}

@keyframes floatSlow {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 15px) scale(0.95); }
}

.login-card {
  width: 420px;
  border-radius: 16px !important;
  position: relative;
  z-index: 1;
  background: rgba(255, 250, 240, 0.96) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(205, 171, 114, 0.3) !important;
  overflow: hidden;
}

.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #e57c1f, #d2a45a, #e57c1f);
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { background-position: 0% 0%; }
  50% { background-position: 100% 0%; }
}

.login-card .el-card__header {
  text-align: center;
  padding: 36px 24px 20px !important;
  border-bottom: none !important;
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.login-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(135deg, #e57c1f, #f5a623);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  box-shadow: 0 4px 12px rgba(229, 124, 31, 0.3);
}

.login-logo-icon {
  font-size: 32px;
  color: #fff;
  font-weight: 700;
}

.login-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.login-subtitle {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin: 0;
  letter-spacing: 1px;
}

.login-card .el-card__body {
  padding: 8px 32px 24px !important;
}

.login-card .el-form-item {
  margin-bottom: 22px;
}

.login-card .el-input__wrapper {
  background: rgba(245, 235, 220, 0.5) !important;
  box-shadow: 0 0 0 1px rgba(205, 171, 114, 0.2) inset !important;
  border-radius: 8px;
  transition: all 0.25s ease;
}

.login-card .el-input__wrapper:hover {
  box-shadow: 0 0 0 1px rgba(205, 171, 114, 0.4) inset !important;
}

.login-card .el-input__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
}

.login-btn {
  width: 100%;
  height: 46px;
  font-size: 16px;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 4px;
  background: linear-gradient(135deg, #e57c1f 0%, #f5a623 100%) !important;
  border: none !important;
  transition: all 0.3s ease;
}

.login-btn:hover {
  background: linear-gradient(135deg, #c96a10 0%, #e57c1f 100%) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(229, 124, 31, 0.35);
}

.error-msg {
  color: var(--el-color-danger);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-top: 4px;
  padding: 8px 12px;
  background: rgba(217, 83, 79, 0.08);
  border-radius: 6px;
}

.login-footer {
  text-align: center;
  padding: 16px 0 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  border-top: 1px solid rgba(205, 171, 114, 0.12);
}
</style>
