const api = require('./api-client');
const {resultCard, loadResultAvatars, renderResultCard} = require('./result-share-card');
// The canvas stays on the page (type=2d), avoiding platform-specific offscreen export behavior.
function prepareResultImage(page, result, stage) {
  const revision = page.shareRevision = (page.shareRevision || 0) + 1, owner = page.shareResultOwner || api.getToken();
  page.shareCardPath = ''; page.shareCardOwner = '';
  const model = resultCard(result, stage);
  const current = () => page.shareRevision === revision && page.pageActive !== false && owner === api.getToken();
  if (!owner || !model || typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function' || typeof wx.canvasToTempFilePath !== 'function') return Promise.resolve('');
  return new Promise((resolve) => {
    let settled = false;
    const deadline = setTimeout(() => finish(''), 3000);
    const finish = (path) => {
      if (settled) return; settled = true; clearTimeout(deadline);
      const valid = current() ? path : '';
      if (valid) {page.shareCardPath = valid; page.shareCardOwner = owner;}
      resolve(valid);
    };
    try {
      wx.createSelectorQuery().in(page).select('#result-share-card').fields({node: true, size: true}).exec(async (nodes) => {
        if (!current()) {finish(''); return;}
        const canvas = nodes?.[0]?.node;
        if (!canvas) {finish(''); return;}
        try {
          const avatars = await loadResultAvatars(model, canvas.createImage?.bind(canvas));
          if (settled || !current()) {finish(''); return;}
          canvas.width = 500;
          canvas.height = 400;
          renderResultCard(canvas.getContext('2d'), model, avatars);
        }
        catch (_) {finish(''); return;}
        setTimeout(() => {
          if (settled || !current()) {finish(''); return;}
          try {wx.canvasToTempFilePath({canvas, width: 500, height: 400, destWidth: 500, destHeight: 400, fileType: 'png',
            success: (response) => finish(response.tempFilePath || ''), fail: () => finish('')}, page);}
          catch (_) {finish('');}
        }, 32);
      });
    } catch (_) {finish('');}
  });
}
module.exports = {prepareResultImage};
