<template>
  <div class="system-config-page">
    <section class="page-hero config-hero">
      <div class="hero-copy">
        <span class="hero-kicker">SYSTEM CONFIGURATION</span>
        <h1>系统配置中心</h1>
        <p>把微信登录、分享、支付和业务参数统一管理。修改后可直接保存到服务端配置中心，适合运营与开发共用。</p>
      </div>
      <div class="hero-actions">
        <div class="hero-summary">
          <span>未保存变更</span>
          <strong>{{ dirtyCount }} 项</strong>
        </div>
        <el-button @click="fetchConfigs" :loading="loading">刷新配置</el-button>
        <el-button
          type="primary"
          :disabled="!hasDirty"
          :loading="batchSaving"
          @click="handleBatchSave"
        >
          批量保存
        </el-button>
      </div>
    </section>

    <section class="config-status-grid">
      <el-card
        v-for="item in statusCards"
        :key="item.title"
        shadow="never"
        class="status-card"
      >
        <div class="status-head">
          <span class="status-label">{{ item.title }}</span>
          <el-tag size="small" :type="item.type">{{ item.tag }}</el-tag>
        </div>
        <div class="status-value">{{ item.value }}</div>
        <div class="status-note">{{ item.note }}</div>
      </el-card>
    </section>

    <section class="capability-grid">
      <el-card
        v-for="card in capabilityCards"
        :key="card.key"
        shadow="never"
        class="capability-card"
      >
        <div class="capability-header">
          <div>
            <strong>{{ card.title }}</strong>
            <p>{{ card.description }}</p>
          </div>
          <el-tag :type="card.type">{{ card.status }}</el-tag>
        </div>
        <div class="capability-metrics">
          <div class="capability-metric">
            <span>完成度</span>
            <strong>{{ card.percent }}%</strong>
          </div>
          <div class="capability-metric">
            <span>必填完成</span>
            <strong>{{ card.readyCount }}/{{ card.requiredCount }}</strong>
          </div>
        </div>
        <div class="capability-tips">{{ card.tip }}</div>
      </el-card>
    </section>

    <section class="group-anchor-row">
      <button
        v-for="group in configGroups"
        :key="group.prefix"
        type="button"
        class="group-anchor"
        @click="activeGroup = group.prefix"
      >
        <strong>{{ group.label }}</strong>
        <span>{{ group.items.length }} 项</span>
      </button>
    </section>

    <el-card
      v-for="group in visibleGroups"
      :key="group.prefix"
      class="config-group-card"
      shadow="never"
    >
      <template #header>
        <div class="card-header group-header">
          <div>
            <strong>{{ group.label }}</strong>
            <p>{{ group.description }}</p>
          </div>
          <el-tag size="small" type="info">{{ group.items.length }} 项</el-tag>
        </div>
      </template>

      <el-alert
        v-if="group.tip"
        :title="group.tip"
        type="success"
        :closable="false"
        class="group-tip"
      />

      <div
        v-for="section in group.sections"
        :key="section.key"
        class="config-section"
      >
        <div class="section-title-row">
          <div>
            <h3>{{ section.label }}</h3>
            <p>{{ section.description }}</p>
          </div>
          <el-tag v-if="section.items.some(item => item.isDirty)" size="small" type="warning">
            有未保存修改
          </el-tag>
        </div>

        <div class="config-field-grid">
          <article
            v-for="cfg in section.items"
            :key="cfg.key"
            class="config-field-card"
            :class="{ 'is-dirty': cfg.isDirty }"
          >
            <div class="field-head">
              <div>
                <div class="field-title">{{ cfg.label }}</div>
                <code class="field-key">{{ cfg.key }}</code>
              </div>
              <div class="field-tags">
                <el-tag v-if="cfg.isRequired" size="small" type="danger" effect="plain">必填</el-tag>
                <el-tag v-if="cfg.isPublic" size="small" type="success">前端可见</el-tag>
                <el-tag v-if="cfg.isSensitive" size="small" type="warning">敏感</el-tag>
                <el-tag v-if="cfg.isDirty" size="small" type="danger">待保存</el-tag>
              </div>
            </div>

            <p class="field-description">{{ cfg.description }}</p>

            <div class="field-control">
              <el-switch
                v-if="cfg.valueType === 'boolean'"
                v-model="cfg.typedValue"
                inline-prompt
                active-text="开"
                inactive-text="关"
                @change="onConfigChange(cfg)"
              />
              <el-input-number
                v-else-if="cfg.valueType === 'number'"
                v-model="cfg.typedValue"
                :min="0"
                :max="999999999"
                controls-position="right"
                class="full-control"
                @change="onConfigChange(cfg)"
              />
              <el-input
                v-else-if="cfg.valueType === 'password'"
                v-model="cfg.typedValue"
                type="password"
                show-password
                class="full-control"
                @input="onConfigChange(cfg)"
              />
              <el-input
                v-else-if="cfg.valueType === 'textarea'"
                v-model="cfg.typedValue"
                type="textarea"
                :rows="3"
                class="full-control"
                @input="onConfigChange(cfg)"
              />
              <el-input
                v-else
                v-model="cfg.typedValue"
                class="full-control"
                @input="onConfigChange(cfg)"
              />
            </div>

            <div class="field-footer">
              <span class="default-value">默认值：{{ formatDefaultValue(cfg) }}</span>
              <div class="field-actions">
                <el-button
                  size="small"
                  :disabled="!cfg.isDirty"
                  @click="handleReset(cfg)"
                >
                  重置
                </el-button>
                <el-button
                  type="primary"
                  size="small"
                  :loading="cfg.saving"
                  :disabled="!cfg.isDirty"
                  @click="handleSaveSingle(cfg)"
                >
                  保存
                </el-button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const configs = ref([])
const loading = ref(false)
const batchSaving = ref(false)
const activeGroup = ref('wechat')
const configLoadState = ref('idle')
const capabilitySummary = ref(null)
const originalValuesMap = new Map()
const fallbackConfigRecords = [
  { key: 'wechat.login_enabled', value: 'true', defaultValue: 'true', description: '是否开启微信登录', valueType: 'boolean', isPublic: true },
  { key: 'wechat.login_app_id', value: 'wx72a4b552a87b44cf', defaultValue: 'wx72a4b552a87b44cf', description: '小程序 AppID（服务端登录校验使用）', valueType: 'text', isPublic: false },
  { key: 'wechat.login_secret', value: '', defaultValue: '', description: '小程序 AppSecret（仅后台保存，不对前端公开）', valueType: 'password', isPublic: false, isSensitive: true },
  { key: 'wechat.login_token_ttl', value: '604800', defaultValue: '604800', description: '登录态默认有效期（秒）', valueType: 'number', isPublic: false },
  { key: 'wechat.login_agreement_url', value: '', defaultValue: '', description: '用户协议链接', valueType: 'url', isPublic: true },
  { key: 'wechat.login_privacy_url', value: '', defaultValue: '', description: '隐私政策链接', valueType: 'url', isPublic: true },
  { key: 'wechat.share_enabled', value: 'true', defaultValue: 'true', description: '是否开启分享给好友 / 朋友圈', valueType: 'boolean', isPublic: true },
  { key: 'wechat.share_title', value: '锦鲤前程邀你一起组队闯世界', defaultValue: '锦鲤前程邀你一起组队闯世界', description: '发送给好友默认标题', valueType: 'text', isPublic: true },
  { key: 'wechat.share_desc', value: '选景区、组战队、拼手气，一起冲上好运榜。', defaultValue: '选景区、组战队、拼手气，一起冲上好运榜。', description: '发送给好友默认描述', valueType: 'textarea', isPublic: true },
  { key: 'wechat.share_path', value: '/pages/home/index', defaultValue: '/pages/home/index', description: '发送给好友默认落地页路径', valueType: 'text', isPublic: true },
  { key: 'wechat.share_query', value: 'from=admin_share', defaultValue: 'from=admin_share', description: '发送给好友附加参数（不含 ?）', valueType: 'text', isPublic: true },
  { key: 'wechat.share_image_url', value: 'https://xcx.ukb88.com/assets/bg/screen.png', defaultValue: 'https://xcx.ukb88.com/assets/bg/screen.png', description: '分享卡片图片 URL', valueType: 'url', isPublic: true },
  { key: 'wechat.share_timeline_title', value: '锦鲤前程开启好运局，来和我一起冲榜', defaultValue: '锦鲤前程开启好运局，来和我一起冲榜', description: '分享到朋友圈标题', valueType: 'text', isPublic: true },
  { key: 'wechat.share_timeline_image_url', value: 'https://xcx.ukb88.com/assets/bg/screen.png', defaultValue: 'https://xcx.ukb88.com/assets/bg/screen.png', description: '分享到朋友圈图片 URL', valueType: 'url', isPublic: true },
  { key: 'wechat.pay_enabled', value: 'false', defaultValue: 'false', description: '是否开启微信支付能力', valueType: 'boolean', isPublic: true },
  { key: 'wechat.pay_mch_id', value: '', defaultValue: '', description: '微信支付商户号 MchId', valueType: 'text', isPublic: false },
  { key: 'wechat.pay_api_v3_key', value: '', defaultValue: '', description: '微信支付 APIv3 Key', valueType: 'password', isPublic: false, isSensitive: true },
  { key: 'wechat.pay_cert_serial_no', value: '', defaultValue: '', description: '微信支付商户证书序列号', valueType: 'text', isPublic: false },
  { key: 'wechat.pay_notify_url', value: '', defaultValue: '', description: '微信支付异步通知地址', valueType: 'url', isPublic: false },
  { key: 'wechat.pay_success_path', value: '/pages/shop/index', defaultValue: '/pages/shop/index', description: '支付成功后的小程序回跳页面', valueType: 'text', isPublic: true },
  { key: 'wechat.pay_currency', value: 'CNY', defaultValue: 'CNY', description: '支付默认币种', valueType: 'text', isPublic: true },
  { key: 'wechat.pay_goods_desc', value: '锦鲤前程幸运金币充值', defaultValue: '锦鲤前程幸运金币充值', description: '微信支付下单默认商品描述', valueType: 'text', isPublic: false },
  { key: 'wechat.pay_sandbox_mode', value: 'true', defaultValue: 'true', description: '是否启用微信支付沙箱模式', valueType: 'boolean', isPublic: false },
  { key: 'game.round_duration', value: '180', defaultValue: '180', description: '每局游戏时长(秒)', valueType: 'number', isPublic: true },
  { key: 'game.min_players', value: '4', defaultValue: '4', description: '最少开局人数', valueType: 'number', isPublic: true },
  { key: 'game.max_players', value: '10', defaultValue: '10', description: '最多玩家数', valueType: 'number', isPublic: true },
  { key: 'game.team_size', value: '2', defaultValue: '2', description: '每队人数', valueType: 'number', isPublic: true },
  { key: 'game.initial_coins', value: '8820', defaultValue: '8820', description: '新用户初始金币', valueType: 'number', isPublic: false },
  { key: 'game.daily_signin_coins', value: '200', defaultValue: '200', description: '每日签到金币奖励', valueType: 'number', isPublic: false },
  { key: 'shop.refresh_interval', value: '86400', defaultValue: '86400', description: '商城刷新间隔(秒)', valueType: 'number', isPublic: true },
  { key: 'system.maintenance_mode', value: '0', defaultValue: '0', description: '维护模式(0=关闭,1=开启)', valueType: 'boolean', isPublic: false },
  { key: 'system.maintenance_message', value: '', defaultValue: '', description: '维护提示消息', valueType: 'textarea', isPublic: false }
]

const groupedPrefixes = [
  {
    prefix: 'wechat',
    label: '微信能力配置',
    description: '集中维护微信登录、分享、支付与外部回调相关参数。',
    tip: '敏感字段只会保存在服务端配置中心，前端不会直接拿到登录密钥或支付密钥。'
  },
  {
    prefix: 'game',
    label: '游戏配置',
    description: '控制局时长、人数、金币和基础玩法参数。',
    tip: ''
  },
  {
    prefix: 'shop',
    label: '商城配置',
    description: '控制商城刷新节奏、支付后落地和商品体验。',
    tip: ''
  },
  {
    prefix: 'system',
    label: '系统配置',
    description: '维护模式、全局公告和后台基础治理开关。',
    tip: ''
  }
]

const fieldMetaMap = {
  'wechat.login_enabled': {
    label: '微信登录开关',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '控制小程序是否允许通过微信授权登录。'
  },
  'wechat.login_app_id': {
    label: '小程序 AppID',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '服务端发起 `code2session` 时使用。'
  },
  'wechat.login_secret': {
    label: '小程序 AppSecret',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '微信登录核心密钥，仅服务端保存。'
  },
  'wechat.login_token_ttl': {
    label: '登录态有效期（秒）',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '服务端签发的业务登录态默认有效期。'
  },
  'wechat.login_agreement_url': {
    label: '用户协议链接',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '登录弹窗或资料页展示的用户协议地址。'
  },
  'wechat.login_privacy_url': {
    label: '隐私政策链接',
    section: 'login',
    sectionLabel: '登录配置',
    sectionDescription: '登录前确认的隐私政策地址。'
  },
  'wechat.share_enabled': {
    label: '分享功能开关',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '控制发送给好友、朋友圈等分享能力。'
  },
  'wechat.share_title': {
    label: '好友分享标题',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '默认分享标题，未配置页面级标题时使用。'
  },
  'wechat.share_desc': {
    label: '好友分享描述',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '分享落地页说明文案，可用于投放活动。'
  },
  'wechat.share_path': {
    label: '默认落地页路径',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '例如 `/pages/home/index`。'
  },
  'wechat.share_query': {
    label: '默认附加参数',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '不带问号，系统会自动拼接场景参数。'
  },
  'wechat.share_image_url': {
    label: '好友分享卡片图',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '建议使用稳定的 HTTPS 图片素材。'
  },
  'wechat.share_timeline_title': {
    label: '朋友圈标题',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '朋友圈分享时优先使用的文案。'
  },
  'wechat.share_timeline_image_url': {
    label: '朋友圈分享图片',
    section: 'share',
    sectionLabel: '分享配置',
    sectionDescription: '朋友圈卡片专用图片，建议突出活动主题。'
  },
  'wechat.pay_enabled': {
    label: '微信支付开关',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '控制前端是否展示微信支付相关入口。'
  },
  'wechat.pay_mch_id': {
    label: '商户号 MchId',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '微信支付商户平台分配的商户号。'
  },
  'wechat.pay_api_v3_key': {
    label: 'APIv3 Key',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '用于解密支付回调报文，属于敏感信息。'
  },
  'wechat.pay_cert_serial_no': {
    label: '商户证书序列号',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '用于签名校验和支付下单。'
  },
  'wechat.pay_notify_url': {
    label: '支付回调通知地址',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '微信支付异步通知会回调到这里。'
  },
  'wechat.pay_success_path': {
    label: '支付成功回跳页',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '支付完成后小程序展示结果的默认页面。'
  },
  'wechat.pay_currency': {
    label: '支付货币',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '默认币种，建议保持 `CNY`。'
  },
  'wechat.pay_goods_desc': {
    label: '订单商品描述',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '发起统一下单时默认的商品说明。'
  },
  'wechat.pay_sandbox_mode': {
    label: '支付沙箱模式',
    section: 'payment',
    sectionLabel: '支付配置',
    sectionDescription: '联调阶段建议开启，上线前记得关闭。'
  }
}

const requiredFields = new Set([
  'wechat.login_app_id',
  'wechat.login_secret',
  'wechat.login_agreement_url',
  'wechat.login_privacy_url',
  'wechat.share_title',
  'wechat.share_path',
  'wechat.share_image_url',
  'wechat.share_timeline_title',
  'wechat.pay_mch_id',
  'wechat.pay_api_v3_key',
  'wechat.pay_notify_url',
  'wechat.pay_goods_desc'
])

function humanizeLabel(key) {
  const tail = key.split('.').pop() || key
  return tail
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function detectValueType(cfg) {
  if (cfg.valueType) return cfg.valueType
  if (cfg.value === 'true' || cfg.value === 'false' || cfg.value === '1' || cfg.value === '0') return 'boolean'
  if (cfg.key.includes('message') || cfg.key.includes('desc')) return 'textarea'
  if (cfg.value !== '' && !Number.isNaN(Number(cfg.value))) return 'number'
  return 'text'
}

function parseTypedValue(cfg) {
  if (cfg.valueType === 'boolean') {
    return cfg.value === true || cfg.value === 'true' || cfg.value === 1 || cfg.value === '1'
  }
  if (cfg.valueType === 'number') {
    return Number(cfg.value)
  }
  return cfg.value ?? ''
}

function stringifyTypedValue(cfg) {
  if (cfg.valueType === 'boolean') return cfg.typedValue ? 'true' : 'false'
  if (cfg.valueType === 'number') return String(cfg.typedValue ?? 0)
  return String(cfg.typedValue ?? '')
}

function inferFieldMeta(raw) {
  const fieldMeta = fieldMetaMap[raw.key] || {}
  return {
    label: fieldMeta.label || humanizeLabel(raw.key),
    section: fieldMeta.section || 'general',
    sectionLabel: fieldMeta.sectionLabel || '通用配置',
    sectionDescription: fieldMeta.sectionDescription || '这里是该分组下的基础配置项。'
  }
}

function initConfigs(rawList) {
  return rawList.map((raw) => {
    const valueType = detectValueType(raw)
    const typedValue = parseTypedValue({ ...raw, valueType })
    const fieldMeta = inferFieldMeta(raw)
    originalValuesMap.set(raw.key, typedValue)

    return {
      key: raw.key,
      value: raw.value,
      typedValue,
      description: raw.description || '',
      defaultValue: raw.defaultValue !== undefined ? raw.defaultValue : raw.value,
      valueType,
      isPublic: !!raw.isPublic,
      isSensitive: !!raw.isSensitive,
      isDirty: false,
      saving: false,
      prefix: raw.key.split('.')[0],
      label: fieldMeta.label,
      section: fieldMeta.section,
      sectionLabel: fieldMeta.sectionLabel,
      sectionDescription: fieldMeta.sectionDescription,
      isRequired: requiredFields.has(raw.key)
    }
  })
}

const configGroups = computed(() => {
  return groupedPrefixes
    .map((group) => {
      const items = configs.value.filter(item => item.key.startsWith(`${group.prefix}.`))
      const sectionMap = new Map()

      items.forEach((item) => {
        if (!sectionMap.has(item.section)) {
          sectionMap.set(item.section, {
            key: item.section,
            label: item.sectionLabel,
            description: item.sectionDescription,
            items: []
          })
        }
        sectionMap.get(item.section).items.push(item)
      })

      return {
        ...group,
        items,
        sections: Array.from(sectionMap.values())
      }
    })
    .filter(group => group.items.length > 0)
})

const visibleGroups = computed(() => {
  if (!activeGroup.value) return configGroups.value
  return configGroups.value.filter(group => group.prefix === activeGroup.value)
})

const hasDirty = computed(() => configs.value.some(item => item.isDirty))
const dirtyCount = computed(() => configs.value.filter(item => item.isDirty).length)

function getConfigItem(key) {
  return configs.value.find(entry => entry.key === key)
}

function hasFilledValue(key) {
  const item = getConfigItem(key)
  if (!item) return false
  if (item.valueType === 'boolean') return item.typedValue === true
  return String(item.typedValue ?? '').trim() !== ''
}

const statusCards = computed(() => {
  if (configLoadState.value === 'failed') {
    return [
      {
        title: '微信登录',
        value: '待连接',
        note: '配置接口暂时不可用，当前展示的是本地默认配置草稿。',
        tag: '异常',
        type: 'warning'
      },
      {
        title: '微信分享',
        value: '待连接',
        note: '分享配置没有拿到服务端实时值，避免继续误显示为已关闭。',
        tag: '异常',
        type: 'warning'
      },
      {
        title: '微信支付',
        value: '待连接',
        note: '支付参数读取失败，请优先恢复 `/api/admin/configs`。',
        tag: '异常',
        type: 'warning'
      },
      {
        title: '待保存修改',
        value: dirtyCount.value ? `${dirtyCount.value} 项` : '0 项',
        note: '当前为兜底视图，可继续编辑但建议先恢复后端配置接口。',
        tag: '兜底',
        type: dirtyCount.value ? 'danger' : 'info'
      }
    ]
  }

  const loginEnabled = hasFilledValue('wechat.login_enabled')
  const shareEnabled = hasFilledValue('wechat.share_enabled')
  const payEnabled = hasFilledValue('wechat.pay_enabled')

  return [
    {
      title: '微信登录',
      value: loginEnabled ? '已开启' : '已关闭',
      note: '决定用户能否通过微信授权进入小游戏',
      tag: loginEnabled ? '运行中' : '关闭',
      type: loginEnabled ? 'success' : 'info'
    },
    {
      title: '微信分享',
      value: shareEnabled ? '已开启' : '已关闭',
      note: '控制转发、活动裂变和朋友圈传播',
      tag: shareEnabled ? '可投放' : '关闭',
      type: shareEnabled ? 'success' : 'info'
    },
    {
      title: '微信支付',
      value: payEnabled ? '已开启' : '未启用',
      note: '仅配置参数，实际下单回调仍需后端业务接口联调',
      tag: payEnabled ? '待联调' : '关闭',
      type: payEnabled ? 'warning' : 'info'
    },
    {
      title: '待保存修改',
      value: dirtyCount.value ? `${dirtyCount.value} 项` : '0 项',
      note: dirtyCount.value ? '建议确认后统一批量保存' : '当前配置已同步',
      tag: dirtyCount.value ? '注意' : '最新',
      type: dirtyCount.value ? 'danger' : 'success'
    }
  ]
})

const capabilityCards = computed(() => {
  if (configLoadState.value === 'failed') {
    return [
      {
        key: 'login',
        title: '微信登录能力',
        description: '账号接入、登录态和协议配置',
        readyCount: 0,
        requiredCount: 4,
        percent: 0,
        status: '待连接',
        type: 'warning',
        tip: '服务端配置接口暂不可用，当前仅展示本地默认模板，不代表线上真实状态。'
      },
      {
        key: 'share',
        title: '微信分享能力',
        description: '裂变传播、活动转发和素材管理',
        readyCount: 0,
        requiredCount: 4,
        percent: 0,
        status: '待连接',
        type: 'warning',
        tip: '建议先恢复后台配置接口，再判断是否真的缺少分享参数。'
      },
      {
        key: 'payment',
        title: '微信支付能力',
        description: '商户参数、支付回调和联调准备',
        readyCount: 0,
        requiredCount: 4,
        percent: 0,
        status: '待连接',
        type: 'warning',
        tip: '支付参数现在拿不到实时值，页面不会再误导成“已经关闭”。'
      }
    ]
  }

  if (capabilitySummary.value && capabilitySummary.value.capabilities) {
    const capabilityMetaMap = {
      login: '账号接入、登录态和协议配置',
      share: '裂变传播、活动转发和素材管理',
      payment: '商户参数、支付回调和联调准备'
    }

    return ['login', 'share', 'payment'].map((key) => {
      const item = capabilitySummary.value.capabilities[key]
      const enabled = !!item.enabled
      const missingKeys = Array.isArray(item.missingKeys) ? item.missingKeys : []
      const readyCount = Number(item.readyCount || 0)
      const requiredCount = Number(item.requiredCount || 0)
      const isReady = !!item.isReady

      return {
        key,
        title: key === 'login' ? '微信登录能力' : key === 'share' ? '微信分享能力' : '微信支付能力',
        description: capabilityMetaMap[key],
        enabled,
        readyCount,
        requiredCount,
        percent: requiredCount > 0 ? Math.round((readyCount / requiredCount) * 100) : 0,
        status: !enabled ? '已关闭' : isReady ? '已就绪' : '待补齐',
        type: !enabled ? 'info' : isReady ? 'success' : 'warning',
        tip: !enabled
          ? '当前能力已关闭，不影响其他模块。'
          : missingKeys.length
            ? `还缺 ${missingKeys.length} 项关键配置：${missingKeys.join('、')}`
            : '关键参数完整，可以进入业务联调或投放阶段。'
      }
    })
  }

  const capabilityDefs = [
    {
      key: 'login',
      title: '微信登录能力',
      description: '账号接入、登录态和协议配置',
      keys: ['wechat.login_app_id', 'wechat.login_secret', 'wechat.login_agreement_url', 'wechat.login_privacy_url'],
      enabledKey: 'wechat.login_enabled'
    },
    {
      key: 'share',
      title: '微信分享能力',
      description: '裂变传播、活动转发和素材管理',
      keys: ['wechat.share_title', 'wechat.share_path', 'wechat.share_image_url', 'wechat.share_timeline_title'],
      enabledKey: 'wechat.share_enabled'
    },
    {
      key: 'payment',
      title: '微信支付能力',
      description: '商户参数、支付回调和联调准备',
      keys: ['wechat.pay_mch_id', 'wechat.pay_api_v3_key', 'wechat.pay_notify_url', 'wechat.pay_goods_desc'],
      enabledKey: 'wechat.pay_enabled'
    }
  ]

  return capabilityDefs.map((item) => {
    const enabled = hasFilledValue(item.enabledKey)
    const readyCount = item.keys.filter(hasFilledValue).length
    const requiredCount = item.keys.length
    const percent = Math.round((readyCount / requiredCount) * 100)
    const isReady = readyCount === requiredCount

    return {
      ...item,
      enabled,
      readyCount,
      requiredCount,
      percent,
      status: !enabled ? '已关闭' : isReady ? '已就绪' : '待补齐',
      type: !enabled ? 'info' : isReady ? 'success' : 'warning',
      tip: !enabled
        ? '当前能力已关闭，不影响其他模块。'
        : isReady
          ? '关键参数完整，可以进入业务联调或投放阶段。'
          : '建议先补齐必填项，再交给开发或运营上线。'
    }
  })
})

function onConfigChange(cfg) {
  cfg.isDirty = cfg.typedValue !== originalValuesMap.get(cfg.key)
}

function formatDefaultValue(cfg) {
  if (cfg.defaultValue === '' || cfg.defaultValue === null || cfg.defaultValue === undefined) {
    return '空'
  }
  return String(cfg.defaultValue)
}

async function fetchConfigs() {
  loading.value = true
  try {
    const res = await request.get('/api/admin/configs')
    if (res.data.code === 0) {
      originalValuesMap.clear()
      configs.value = initConfigs(res.data.data || [])
      configLoadState.value = 'success'
    } else {
      originalValuesMap.clear()
      configs.value = initConfigs(fallbackConfigRecords)
      configLoadState.value = 'failed'
      ElMessage.error(res.data.message || '获取配置失败')
    }
  } catch (_err) {
    originalValuesMap.clear()
    configs.value = initConfigs(fallbackConfigRecords)
    configLoadState.value = 'failed'
    ElMessage.error('获取配置失败')
  } finally {
    loading.value = false
  }
}

async function fetchConfigSummary() {
  try {
    const res = await request.get('/api/admin/configs/summary')
    if (res.data.code === 0) {
      capabilitySummary.value = res.data.data || null
      return
    }
  } catch (_err) {
    // 摘要接口失败时回退到前端本地推断，不阻断配置页使用
  }
  capabilitySummary.value = null
}

async function handleSaveSingle(cfg) {
  cfg.saving = true
  try {
    await request.put('/api/admin/configs', {
      configs: [{ key: cfg.key, value: stringifyTypedValue(cfg) }]
    })
    originalValuesMap.set(cfg.key, cfg.typedValue)
    cfg.isDirty = false
    fetchConfigSummary()
    ElMessage.success(`已保存：${cfg.label}`)
  } catch (_err) {
    ElMessage.error(`保存失败：${cfg.label}`)
  } finally {
    cfg.saving = false
  }
}

async function handleBatchSave() {
  const dirtyConfigs = configs.value.filter(item => item.isDirty)
  if (!dirtyConfigs.length) return

  batchSaving.value = true
  try {
    await request.put('/api/admin/configs', {
      configs: dirtyConfigs.map(item => ({
        key: item.key,
        value: stringifyTypedValue(item)
      }))
    })

    dirtyConfigs.forEach((item) => {
      originalValuesMap.set(item.key, item.typedValue)
      item.isDirty = false
    })

    fetchConfigSummary()
    ElMessage.success(`已批量保存 ${dirtyConfigs.length} 项配置`)
  } catch (_err) {
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
  fetchConfigSummary()
})
</script>

<style scoped>
.config-hero {
  margin-bottom: 16px;
}

.hero-copy {
  max-width: 760px;
}

.hero-kicker {
  display: inline-block;
  margin-bottom: 10px;
  color: #c96a10;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.hero-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.hero-summary {
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 10px 14px;
  border: 1px solid rgba(177, 129, 66, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  color: #8a7051;
  font-size: 12px;
}

.hero-summary strong {
  margin-top: 4px;
  color: #4a2d1a;
  font-size: 16px;
}

.config-status-grid,
.capability-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.capability-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.status-card,
.capability-card,
.config-group-card {
  background: rgba(255, 252, 246, 0.88);
}

.status-head,
.capability-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.status-label {
  font-size: 13px;
  color: #8a7051;
}

.status-value {
  margin-top: 10px;
  font-size: 26px;
  font-weight: 800;
  color: #4a2d1a;
}

.status-note,
.capability-header p,
.capability-tips {
  margin-top: 8px;
  font-size: 12px;
  color: #9c7a52;
  line-height: 1.6;
}

.capability-header strong {
  color: #4a2d1a;
  font-size: 16px;
}

.capability-header p {
  margin-bottom: 0;
}

.capability-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.capability-metric {
  padding: 12px;
  border: 1px solid rgba(177, 129, 66, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.58);
}

.capability-metric span {
  color: #8a7051;
  font-size: 12px;
}

.capability-metric strong {
  display: block;
  margin-top: 6px;
  color: #4a2d1a;
  font-size: 22px;
}

.group-anchor-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.group-anchor {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid rgba(177, 129, 66, 0.18);
  border-radius: 999px;
  background: rgba(255, 253, 245, 0.88);
  color: #4a2d1a;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.group-anchor:hover {
  transform: translateY(-1px);
  border-color: rgba(229, 124, 31, 0.34);
  box-shadow: 0 10px 22px rgba(96, 61, 27, 0.08);
}

.group-anchor strong {
  font-size: 14px;
}

.group-anchor span {
  color: #8a7051;
  font-size: 12px;
}

.group-header {
  align-items: flex-start;
}

.group-header p {
  margin: 6px 0 0;
  color: #8a7051;
  font-size: 13px;
}

.group-tip {
  margin-bottom: 18px;
}

.config-group-card {
  margin-bottom: 16px;
}

.config-section + .config-section {
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px solid rgba(177, 129, 66, 0.14);
}

.section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-title-row h3 {
  margin: 0;
  font-size: 18px;
  color: #4a2d1a;
}

.section-title-row p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8a7051;
}

.config-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.config-field-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(177, 129, 66, 0.16);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.config-field-card.is-dirty {
  border-color: rgba(229, 124, 31, 0.46);
  box-shadow: 0 12px 26px rgba(229, 124, 31, 0.1);
}

.config-field-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(96, 61, 27, 0.08);
}

.field-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.field-title {
  color: #4a2d1a;
  font-size: 15px;
  font-weight: 760;
}

.field-key {
  display: inline-block;
  margin-top: 6px;
  color: #9c7a52;
  font-size: 12px;
}

.field-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.field-description {
  margin: 0;
  color: #8a7051;
  font-size: 13px;
  line-height: 1.6;
}

.field-control {
  min-width: 0;
}

.full-control {
  width: 100%;
}

.field-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
}

.default-value {
  color: rgba(92, 63, 32, 0.58);
  font-size: 12px;
}

.field-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 1280px) {
  .config-status-grid,
  .capability-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .hero-actions {
    justify-content: flex-start;
  }

  .config-field-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .config-status-grid,
  .capability-grid {
    grid-template-columns: 1fr;
  }

  .capability-metrics {
    grid-template-columns: 1fr;
  }

  .field-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
