<template>
  <el-container class="admin-layout">
    <el-aside width="220px" class="admin-aside">
      <div class="logo">
        <h2>锦鲤前程</h2>
        <span class="logo-sub">管理后台</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409EFF"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>控制台</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item index="/items">
          <el-icon><Goods /></el-icon>
          <span>道具管理</span>
        </el-menu-item>
        <el-menu-item index="/games">
          <el-icon><Monitor /></el-icon>
          <span>对局监控</span>
        </el-menu-item>
        <el-menu-item index="/stats">
          <el-icon><TrendCharts /></el-icon>
          <span>数据统计</span>
        </el-menu-item>
        <el-menu-item index="/announcements">
          <el-icon><Bell /></el-icon>
          <span>公告管理</span>
        </el-menu-item>
        <el-menu-item index="/admins">
          <el-icon><Setting /></el-icon>
          <span>管理员管理</span>
        </el-menu-item>
        <el-menu-item index="/rooms">
          <el-icon><Coin /></el-icon>
          <span>房间管理</span>
        </el-menu-item>
        <el-menu-item index="/logs">
          <el-icon><Document /></el-icon>
          <span>操作日志</span>
        </el-menu-item>
        <el-menu-item index="/configs">
          <el-icon><Tools /></el-icon>
          <span>系统配置</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="admin-header">
        <div class="header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="breadcrumbText">{{ breadcrumbText }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click">
            <span class="admin-avatar">
              <el-icon><UserFilled /></el-icon>
              <span>{{ authStore.admin?.username || 'Admin' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  DataAnalysis,
  User,
  Goods,
  Monitor,
  TrendCharts,
  UserFilled,
  ArrowDown,
  Bell,
  Setting,
  HomeFilled,
  Document,
  Tools
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/users')) return '/users'
  if (path.startsWith('/items')) return '/items'
  if (path.startsWith('/games')) return '/games'
  if (path.startsWith('/stats')) return '/stats'
  if (path.startsWith('/admins')) return '/admins'
  if (path.startsWith('/rooms')) return '/rooms'
  if (path.startsWith('/logs')) return '/logs'
  if (path.startsWith('/announcements')) return '/announcements'
  if (path.startsWith('/configs')) return '/configs'
  return '/dashboard'
})

const breadcrumbText = computed(() => {
  const name = route.name
  const map = {
    Dashboard: '控制台',
    UserList: '用户管理',
    UserDetail: '用户详情',
    ItemList: '道具管理',
    GameList: '对局监控',
    GameDetail: '对局详情',
    StatsOverview: '数据统计',
    AdminList: '管理员管理',
    RoomList: '房间管理',
    OperationLogs: '操作日志',
    AnnouncementList: '公告管理',
    SystemConfig: '系统配置'
  }
  return map[name] || ''
})

function handleLogout() {
  authStore.logout()
  router.push({ name: 'Login' })
}
</script>

<style scoped>
.admin-layout {
  height: 100vh;
}

.admin-aside {
  background-color: #304156;
  overflow-y: auto;
}

.logo {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo h2 {
  color: #fff;
  font-size: 18px;
  margin: 0;
  line-height: 1.4;
}

.logo-sub {
  color: #bfcbd9;
  font-size: 12px;
}

.admin-aside .el-menu {
  border-right: none;
}

.admin-header {
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.header-right {
  display: flex;
  align-items: center;
}

.admin-avatar {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #333;
}

.admin-main {
  background: #f0f2f5;
  min-height: calc(100vh - 60px);
}
</style>
