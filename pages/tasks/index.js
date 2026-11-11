const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const privacyConsent = require('../../utils/privacy-consent');

Page({
  data: {nav: {}, tasks: [], date: '', loading: false, claiming: '', error: ''},
  onLoad() { this.setData({nav: getNavLayout()}); },
  onShow() { if (privacyConsent.canEnter()) this.loadTasks(); },
  loadTasks() {
    const token = api.getToken();
    const requestId = this.requestId = (this.requestId || 0) + 1;
    this.setData({loading: true, error: '', tasks: []});
    if (!token) {
      this.setData({loading: false, error: '登录后可参与每日任务，游客对局不计入任务进度。'});
      return Promise.resolve();
    }
    return api.get('/tasks').then((data) => {
      if (requestId === this.requestId && token === api.getToken()) {
        this.setData({
          tasks: data.tasks.map((task) => ({
            ...task,
            disabled: Boolean(task.claimed || task.progress < task.target || this.data.claiming),
            buttonText: task.claimed ? '已领取' : task.progress >= task.target ? '领取' : '未完成',
            isLoading: false,
          })),
          date: data.date,
        });
      }
    }).catch((error) => {
      if (requestId === this.requestId) {
        this.setData({error: error.statusCode === 404
          ? '每日任务服务尚未部署，请更新服务端后再试。'
          : error.message || '任务加载失败，请重试'});
      }
    }).finally(() => { if (requestId === this.requestId) this.setData({loading: false}); });
  },
  claimReward(event) {
    if (this.data.claiming) return;
    const taskId = event.currentTarget.dataset.id;
    const token = api.getToken();
    this.setData({
      claiming: taskId,
      tasks: this.data.tasks.map((task) => ({
        ...task, disabled: true, isLoading: task.id === taskId,
      })),
    });
    // 先释放 claiming 再刷新列表：loadTasks 依赖 claiming 计算按钮禁用态，否则其余可领取任务会被误禁用
    return api.post(`/tasks/${taskId}/claim`, {}).then((data) => {
      if (token === api.getToken()) wx.showToast({title: `获得 ${data.reward} 金币`, icon: 'success'});
      this.setData({claiming: ''});
      return this.loadTasks();
    }).catch((error) => {
      wx.showToast({title: error.message || '领取失败，请重试', icon: 'none'});
      this.setData({claiming: ''});
      return this.loadTasks();
    });
  },
  onBack() { wx.navigateBack(); },
});
