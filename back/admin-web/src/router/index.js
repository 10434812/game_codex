import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Login from '@/views/Login.vue'
import Dashboard from '@/views/Dashboard.vue'
import UserList from '@/views/users/UserList.vue'
import UserDetail from '@/views/users/UserDetail.vue'
import ItemList from '@/views/items/ItemList.vue'
import GameList from '@/views/games/GameList.vue'
import GameDetail from '@/views/games/GameDetail.vue'
import StatsOverview from '@/views/stats/StatsOverview.vue'
import AnnouncementList from '@/views/announcements/AnnouncementList.vue'
import SystemConfig from '@/views/configs/SystemConfig.vue'
import AdminList from '@/views/admins/AdminList.vue'
import RoomList from '@/views/rooms/RoomList.vue'
import OperationLogs from '@/views/logs/OperationLogs.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { noAuth: true }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: Dashboard,
    meta: { requiresAuth: true }
  },
  {
    path: '/users',
    name: 'UserList',
    component: UserList,
    meta: { requiresAuth: true }
  },
  {
    path: '/users/:id',
    name: 'UserDetail',
    component: UserDetail,
    meta: { requiresAuth: true }
  },
  {
    path: '/items',
    name: 'ItemList',
    component: ItemList,
    meta: { requiresAuth: true }
  },
  {
    path: '/games',
    name: 'GameList',
    component: GameList,
    meta: { requiresAuth: true }
  },
  {
    path: '/games/:id',
    name: 'GameDetail',
    component: GameDetail,
    meta: { requiresAuth: true }
  },
  {
    path: '/stats',
    name: 'StatsOverview',
    component: StatsOverview,
    meta: { requiresAuth: true }
  },
  {
    path: '/announcements',
    name: 'AnnouncementList',
    component: AnnouncementList,
    meta: { requiresAuth: true }
  },
  {
    path: '/configs',
    name: 'SystemConfig',
    component: SystemConfig,
    meta: { requiresAuth: true }
  },
  {
    path: '/admins',
    name: 'AdminList',
    component: AdminList,
    meta: { requiresAuth: true }
  },
  {
    path: '/rooms',
    name: 'RoomList',
    component: RoomList,
    meta: { requiresAuth: true }
  },
  {
    path: '/logs',
    name: 'OperationLogs',
    component: OperationLogs,
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    redirect: '/dashboard'
  }
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes
})

router.beforeEach((to, from, next) => {
  if (to.meta.noAuth) {
    return next()
  }

  const authStore = useAuthStore()
  if (!authStore.isLoggedIn) {
    return next({ name: 'Login' })
  }

  next()
})

export default router
