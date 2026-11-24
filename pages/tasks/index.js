const analytics = require('../../utils/analytics');
const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const runtime = require('../../utils/runtime-config');
const privacyConsent = require('../../utils/privacy-consent');
const {ensureLogin} = require('../../utils/user-profile');

Page({
  data: {nav: {}, tasks: [], date: '', loading: false, claiming: '', error: '', loginRequired: false, loginPending: false, retention: null, retentionClaiming: '', leaderboard: [], leaderboardVisible: false, rankLoading: false, rankError: ''},
  onLoad() { this.setData({nav: getNavLayout()}); },
  onShow() { this.active = true; if (privacyConsent.canEnter()) this.loadTasks(); },
  onHide() {this.active = false; this.rewardRequest = null; this.requestId = (this.requestId || 0) + 1; this.rankRequestId = (this.rankRequestId || 0) + 1; this.setData({claiming: '', retentionClaiming: '', rankLoading: false});},
  onUnload() { this.active = false; this.rewardRequest = null; this.rankRequestId = (this.rankRequestId || 0) + 1; this.requestId = (this.requestId || 0) + 1; this.loginEpoch = (this.loginEpoch || 0) + 1; },
  async onLogin() {
    if (this.data.loginPending) return;
    const epoch = this.loginEpoch || 0;
    this.setData({loginPending: true, error: ''});
    try {
      await ensureLogin();
      if (epoch === (this.loginEpoch || 0)) await this.loadTasks();
    } catch (error) {
      if (epoch === (this.loginEpoch || 0)) this.setData({error: error.message || '微信登录失败，请重试', loginRequired: !api.isLoggedIn()});
    } finally {
      if (epoch === (this.loginEpoch || 0)) this.setData({loginPending: false});
    }
  },
  loadTasks() {
    const token = api.getToken();
    const requestId = this.requestId = (this.requestId || 0) + 1;
    if (!token || (this.tasksOwner !== token && !api.isRecoveredToken(this.tasksOwner, token))) {
      this.tasksOwner = token; this.rewardRequest = null;
      this.setData({retention: null, leaderboard: [], leaderboardVisible: false, claiming: '', retentionClaiming: '', rankError: '', rankLoading: false});
    }
    this.tasksOwner = token;
    this.setData({loading: true, error: '', tasks: [], date: '', loginRequired: !token});
    if (!token) {
      this.setData({loading: false, error: '微信登录后可参与每日任务。'});
      return Promise.resolve();
    }
    return api.get('/tasks', runtime.isApiSupported('retention') ? {includeRetention: 1} : {}).then((data) => {
      if (requestId === this.requestId && this.isCurrentAccount(token)) {
        this.tasksOwner = api.getToken();
        this.setData({
          tasks: data.tasks.map((task) => ({
            ...task,
            disabled: Boolean(task.claimed || task.progress < task.target || this.data.claiming),
            buttonText: task.claimed ? '已领取' : task.progress >= task.target ? '领取' : '未完成',
            isLoading: false,
          })),
          date: data.date, retention: data.retention || null,
        });
      }
    }).catch((error) => {
      if (requestId !== this.requestId) return;
      if (!api.getToken()) return this.showExpiredLogin();
      if (this.isCurrentAccount(token)) {
        this.setData({error: error.statusCode === 404
          ? '每日任务暂不可用，请稍后重试。'
          : error.message || '任务加载失败，请重试'});
      }
    }).finally(() => { if (requestId === this.requestId) this.setData({loading: false}); });
  },
  isCurrentAccount(token) {
    const current = api.getToken();
    return Boolean(current && (token === current || api.isRecoveredToken(token, current)));
  },
  showExpiredLogin() {
    this.tasksOwner = '';
    this.rewardRequest = null;
    this.setData({loginRequired: true, error: '登录已失效，请重新微信登录。', tasks: [], date: '', retention: null,
      leaderboard: [], leaderboardVisible: false, rankLoading: false, rankError: '', claiming: '', retentionClaiming: ''});
  },
  claimReward(event) {
    const taskId = event.currentTarget.dataset.id;
    return this.runReward(`/tasks/${encodeURIComponent(taskId)}/claim`, taskId, 'task_claim');
  },
  claimRetention(event) {
    const id = event.currentTarget.dataset.id;
    return this.runReward(id === 'checkin' ? '/retention/checkin' : `/retention/milestones/${encodeURIComponent(id)}/claim`, id, id === 'checkin' ? 'checkin' : 'growth_claim');
  },
  runReward(path, id, eventName) {
    if (this.rewardRequest || this.data.loading || this.active === false) return;
    const token = api.getToken();
    if (!token) {this.setData({loginRequired: true}); return;}
    const request = {token}; this.rewardRequest = request;
    const activeRequest = () => this.rewardRequest === request && this.active !== false;
    const current = () => activeRequest() && this.isCurrentAccount(token);
    this.setData({claiming: eventName === 'task_claim' ? id : '', retentionClaiming: eventName === 'task_claim' ? '' : id,
      tasks: this.data.tasks.map((task) => ({...task, disabled: true, isLoading: eventName === 'task_claim' && task.id === id}))});
    return api.post(path, {}).then((data) => {
      if (!current()) return;
      if (!data.alreadyClaimed) analytics.track(eventName, {taskId: id});
      wx.showToast({title: data.alreadyClaimed ? '奖励已领取并到账' : `获得 ${data.reward} 锦鲤币`, icon: 'success'});
      // Unlock before recomputing the task button state.
      this.setData({claiming: '', retentionClaiming: ''});
      return this.loadTasks();
    }).catch((error) => {
      if (activeRequest() && !api.getToken()) return this.showExpiredLogin();
      if (!current()) return;
      wx.showToast({title: error.message || '领取失败，请重试', icon: 'none'});
      this.setData({claiming: '', retentionClaiming: ''});
      return this.loadTasks();
    }).finally(() => {
      if (activeRequest()) {
        this.rewardRequest = null;
        this.setData({claiming: '', retentionClaiming: ''});
      }
    });
  },
  showLeaderboard() {
    this.setData({leaderboardVisible: true});
    return this.loadLeaderboard();
  },
  loadLeaderboard() {
    if (this.data.rankLoading) return;
    const token = api.getToken(), requestId = this.rankRequestId = (this.rankRequestId || 0) + 1;
    if (!token) {this.setData({loginRequired: true}); return;}
    this.setData({rankLoading: true, rankError: ''});
    return api.get('/leaderboard', {type: 'exp', limit: 20}).then((rows) => {
      if (requestId !== this.rankRequestId || !this.isCurrentAccount(token)) return;
      if (!Array.isArray(rows)) throw new Error('排行榜数据异常，请重试');
      let rank = 1;
      this.setData({leaderboard: rows.map((row, index) => {if (!index || Number(row.totalExp) !== Number(rows[index - 1].totalExp)) rank = index + 1; return {...row, rank};})});
    }).catch((error) => {
      if (requestId !== this.rankRequestId) return;
      if (!api.getToken()) return this.showExpiredLogin();
      if (this.isCurrentAccount(token)) this.setData({rankError: error.message || '排行榜加载失败，请重试'});
    }).finally(() => {if (requestId === this.rankRequestId) this.setData({rankLoading: false});});
  },
  onBack() { wx.navigateBack(); },
});
