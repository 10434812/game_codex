import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
const Login = () => import('@/views/Login.vue')
const Dashboard = () => import('@/views/Dashboard.vue')
const UserList = () => import('@/views/users/UserList.vue')
const UserDetail = () => import('@/views/users/UserDetail.vue')
const ItemList = () => import('@/views/items/ItemList.vue')
const GameList = () => import('@/views/games/GameList.vue')
const GameDetail = () => import('@/views/games/GameDetail.vue')
const StatsOverview = () => import('@/views/stats/StatsOverview.vue')
const AnnouncementList = () => import('@/views/announcements/AnnouncementList.vue')
const SystemConfig = () => import('@/views/configs/SystemConfig.vue')
const AdminList = () => import('@/views/admins/AdminList.vue')
const RoomList = () => import('@/views/rooms/RoomList.vue')
const OperationLogs = () => import('@/views/logs/OperationLogs.vue')
const FortuneReality = () => import('@/views/fortune/FortuneReality.vue')

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
    meta: { requiresAuth: true, requiresSuper: true }
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
    path: '/fortune',
    name: 'FortuneReality',
    component: FortuneReality,
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/:pathMatch(.*)*',
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

  if (to.meta.requiresSuper && !authStore.isSuper) {
    return next({ name: 'Dashboard' })
  }

  next()
})

export default router
