<template>
  <router-view v-if="route.meta.noAuth" />
  <AdminLayout v-else />
</template>

<script setup>
import { useRoute } from 'vue-router'
import AdminLayout from '@/components/AdminLayout.vue'

const route = useRoute()
</script>
