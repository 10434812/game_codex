<template>
  <el-container class="admin-layout">
    <el-aside width="248px" class="admin-aside desktop-aside">
      <div class="logo-area">
        <div class="logo-mark">锦</div>
        <div class="logo-copy">
          <h1 class="logo-title">锦鲤前程</h1>
          <span class="logo-sub">运营管理后台</span>
        </div>
      </div>

      <el-menu
        :default-active="activeMenu"
        router
        class="admin-menu"
      >
        <el-menu-item
          v-for="item in menuItems"
          :key="item.index"
          :index="item.index"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container class="admin-shell">
      <el-header class="admin-header">
        <div class="header-left">
          <div class="header-topline">
            <el-button
              class="menu-toggle"
              circle
              plain
              @click="drawerVisible = true"
            >
              <el-icon><Operation /></el-icon>
            </el-button>
            <h2 class="header-title">{{ pageTitle }}</h2>
            <el-tag size="small" effect="plain" type="warning">{{ dateLabel }}</el-tag>
          </div>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">后台首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="breadcrumbText">{{ breadcrumbText }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="header-right">
          <div class="header-actions">
            <el-button plain @click="router.push({ name: 'SystemConfig' })">配置中心</el-button>
            <el-button type="primary" @click="router.push({ name: 'AnnouncementList' })">发布公告</el-button>
          </div>
          <el-dropdown trigger="click">
            <span class="admin-avatar">
              <el-icon><UserFilled /></el-icon>
              <span>{{ authStore.admin?.username || 'Admin' }}</span>
              <el-tag size="small" effect="dark" type="info">{{ authStore.admin?.role || 'viewer' }}</el-tag>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push({ name: 'AdminList' })">管理员管理</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
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

  <el-drawer
    v-model="drawerVisible"
    direction="ltr"
    size="280px"
    class="mobile-menu-drawer"
  >
    <template #header>
      <div class="drawer-header">
        <strong>锦鲤前程</strong>
        <span>后台导航</span>
      </div>
    </template>

    <el-menu
      :default-active="activeMenu"
      router
      class="drawer-menu"
      @select="drawerVisible = false"
    >
      <el-menu-item
        v-for="item in menuItems"
        :key="item.index"
        :index="item.index"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </el-menu-item>
    </el-menu>
  </el-drawer>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
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
  Document,
  Tools,
  Operation,
  Coin
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const drawerVisible = ref(false)

const menuItems = [
  { index: '/dashboard', label: '控制台', icon: DataAnalysis },
  { index: '/users', label: '用户管理', icon: User },
  { index: '/items', label: '道具管理', icon: Goods },
  { index: '/games', label: '对局监控', icon: Monitor },
  { index: '/stats', label: '数据统计', icon: TrendCharts },
  { index: '/announcements', label: '公告管理', icon: Bell },
  { index: '/admins', label: '管理员管理', icon: Setting },
  { index: '/rooms', label: '房间管理', icon: Coin },
  { index: '/logs', label: '操作日志', icon: Document },
  { index: '/configs', label: '系统配置', icon: Tools }
]

const titleMap = {
  Dashboard: '控制台总览',
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

watch(
  () => route.fullPath,
  () => {
    drawerVisible.value = false
  }
)

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

const breadcrumbText = computed(() => titleMap[route.name] || '')
const pageTitle = computed(() => titleMap[route.name] || '锦鲤前程后台')
const dateLabel = computed(() => {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date())
})

function handleLogout() {
  authStore.logout()
  router.push({ name: 'Login' })
}
</script>

<style scoped>
.header-topline {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #4a2d1a;
}

.drawer-header span {
  font-size: 12px;
  color: #8a7051;
}

.drawer-menu {
  border-right: none;
}

.menu-toggle {
  display: none;
}

@media (max-width: 960px) {
  .desktop-aside {
    display: none;
  }

  .menu-toggle {
    display: inline-flex;
  }

  .header-actions {
    display: none;
  }
}
</style>
