import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: '',
  timeout: 15000
})

request.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore()
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401) {
      const authStore = useAuthStore()
      authStore.logout()
      router.push({ name: 'Login' })
    } else if (status === 403) {
      const message = error.response?.data?.message || ''
      if (message.includes('已被停用')) {
        // 账号被停用：视同失效，清理登录态（M-3）
        const authStore = useAuthStore()
        authStore.logout()
        router.push({ name: 'Login' })
      } else {
        // 权限不足：给出明确提示，避免被误认为系统故障（M-3）
        ElMessage.error(message || '无权限执行该操作')
      }
    }
    return Promise.reject(error)
  }
)

export default request
