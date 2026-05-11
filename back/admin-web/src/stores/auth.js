import { defineStore } from 'pinia'
import request from '@/utils/request'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('admin_token') || '',
    admin: null
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    isSuper: (state) => state.admin?.role === 'super'
  },
  actions: {
    async login(username, password) {
      const res = await request.post('/api/admin/auth/login', { username, password })
      this.token = res.data.data.token
      this.admin = res.data.data.admin
      localStorage.setItem('admin_token', this.token)
    },
    logout() {
      this.token = ''
      this.admin = null
      localStorage.removeItem('admin_token')
    }
  }
})
