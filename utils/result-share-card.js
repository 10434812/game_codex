// Generated from minigame/src/render/result-share-card.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultCard = resultCard;
exports.resultShareTitle = resultShareTitle;
exports.loadResultAvatars = loadResultAvatars;
exports.renderResultCard = renderResultCard;
function resultCard(result, stage) {
    if (!result || result.interrupted || result.title === '对局已中断' || !Array.isArray(result.ranking)
        || result.ranking.length < 1 || result.ranking.length > 10)
        return null;
    const self = result.ranking.find((player) => player.isSelf);
    if (!self || ![self.rank, self.score, result.coins].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)
        || !self.rank || self.rank > result.ranking.length)
        return null;
    const podium = [2, 1, 3].flatMap((rank) => {
        const player = result.ranking?.find((entry) => entry.rank === rank);
        if (!player || !Number.isSafeInteger(player.score) || Number(player.score) < 0)
            return [];
        return [{
                rank,
                score: player.score,
                isSelf: player === self,
                name: player.name || '锦鲤玩家',
                avatar: player.avatar || '',
            }];
    });
    return {
        name: self.name || '锦鲤玩家',
        avatar: self.avatar || '',
        stage,
        rank: self.rank,
        score: self.score,
        coins: result.coins,
        players: result.ranking.length,
        podium,
    };
}
function resultShareTitle(card) {
    return `锦鲤前程 · ${card.score}分，第${card.rank}名`;
}
function loadResultAvatars(card, createImage) {
    const urls = [...card.podium.map((player) => player.avatar), card.avatar];
    const requests = new Map();
    return Promise.all(urls.map((avatar) => {
        if (!avatar || !createImage)
            return null;
        const cached = requests.get(avatar);
        if (cached)
            return cached;
        const request = new Promise((resolve) => {
            let image;
            try {
                image = createImage();
            }
            catch {
                resolve(null);
                return;
            }
            const timeout = setTimeout(() => finish(null), 1600);
            function finish(loaded) {
                clearTimeout(timeout);
                image.onload = null;
                image.onerror = null;
                resolve(loaded);
            }
            image.onload = () => finish(image.width > 0 && image.height > 0 ? image : null);
            image.onerror = () => finish(null);
            try {
                image.src = avatar;
            }
            catch {
                finish(null);
            }
        });
        requests.set(avatar, request);
        return request;
    }));
}
function circle(ctx, x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
}
function drawAvatar(ctx, image, x, y, radius) {
    circle(ctx, x, y, radius + 4, '#efcf88');
    circle(ctx, x, y, radius + 2, '#fffaf1');
    if (!image) {
        circle(ctx, x, y, radius, '#f3e6cd');
        circle(ctx, x, y - radius * 0.25, radius * 0.27, '#b18a5b');
        ctx.beginPath();
        ctx.arc(x, y + radius * 0.64, radius * 0.57, Math.PI, 2 * Math.PI);
        ctx.fill();
        return;
    }
    const scale = radius * 2 / Math.min(image.width, image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
    ctx.restore();
}
function podiumShape(ctx, { x, y, width, height }, radius) {
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
}
function renderResultCard(ctx, card, avatars = []) {
    ctx.save();
    ctx.globalAlpha = 1;
    const paper = ctx.createLinearGradient(0, 0, 0, 400);
    paper.addColorStop(0, '#fff9e9');
    paper.addColorStop(1, '#f0dfb8');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 500, 400);
    const text = (value, x, y, size, color, bold = false, width = 440) => {
        ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
        ctx.fillStyle = color;
        const chars = Array.from(value);
        let clipped = false;
        while (chars.length && ctx.measureText(chars.join('') + (clipped ? '…' : '')).width > width) {
            chars.pop();
            clipped = true;
        }
        ctx.fillText(chars.join('') + (clipped ? '…' : ''), x, y);
    };
    const ink = '#523516';
    const muted = '#705233';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const selfAvatar = avatars[card.podium.length] || avatars[card.podium.findIndex((player) => player.isSelf)];
    if (selfAvatar)
        drawAvatar(ctx, selfAvatar, 43, 32, 13);
    text(card.name, selfAvatar ? 66 : 28, 33, 19, ink, true, 255);
    ctx.textAlign = 'right';
    text('• 联网对战', 472, 33, 16, ink, true, 130);
    ctx.fillStyle = '#cbb17d';
    ctx.fillRect(28, 56, 444, 1);
    ctx.textAlign = 'center';
    text(`你获得第 ${card.rank} 名`, 250, 96, 41, ink, true);
    const summary = card.rank > 3 ? `总计 ${card.players} 玩家 · 我的积分 ${card.score}` : `总计 ${card.players} 玩家`;
    text(summary, 250, 134, 17, muted, true);
    const medalColors = ['#c28119', '#617895', '#a35a2d'];
    const podiumGap = 10;
    const columnWidths = card.podium.map((player) => player.rank === 1 ? 166 : 129);
    const podiumWidth = columnWidths.reduce((sum, width) => sum + width, 0) + (columnWidths.length - 1) * podiumGap;
    let columnLeft = (500 - podiumWidth) / 2;
    card.podium.forEach((player, index) => {
        const x = columnLeft;
        const columnWidth = columnWidths[index];
        columnLeft += columnWidth + podiumGap;
        const center = x + columnWidth / 2;
        const champion = player.rank === 1;
        const y = champion ? 179 : 217;
        const color = medalColors[player.rank - 1];
        const radius = champion ? 45 : 29;
        const avatarY = y + (champion ? 59 : 42);
        podiumShape(ctx, { x, y, width: columnWidth, height: 345 - y }, champion ? 17 : 50);
        if (champion) {
            const gold = ctx.createLinearGradient(0, y, 0, 345);
            gold.addColorStop(0, '#efbd62');
            gold.addColorStop(1, '#a9611e');
            ctx.fillStyle = gold;
        }
        else {
            ctx.fillStyle = '#fffaf0';
        }
        ctx.fill();
        ctx.strokeStyle = player.isSelf ? '#b8863c' : '#dec9a3';
        ctx.lineWidth = player.isSelf ? 2 : 1;
        ctx.stroke();
        if (champion) {
            ctx.beginPath();
            ctx.moveTo(center - 9, 166);
            ctx.lineTo(center - 13, 152);
            ctx.lineTo(center - 5, 158);
            ctx.lineTo(center, 149);
            ctx.lineTo(center + 5, 158);
            ctx.lineTo(center + 13, 152);
            ctx.lineTo(center + 9, 166);
            ctx.closePath();
            ctx.fillStyle = '#ac7427';
            ctx.fill();
            ctx.fillRect(center - 9, 168, 18, 2);
        }
        drawAvatar(ctx, avatars[index], center, avatarY, radius);
        circle(ctx, center + radius * 0.94, avatarY + radius * 0.53, champion ? 13 : 11, color);
        text(String(player.rank), center + radius * 0.94, avatarY + radius * 0.53, 15, '#fffaf0', true);
        const label = player.isSelf ? `我 · ${player.name}` : player.name;
        text(label, center, champion ? 301 : 306, 16, champion ? '#fff9e9' : ink, true, columnWidth - 14);
        text(String(player.score), center, 327, champion ? 32 : 25, champion ? '#fff9e9' : ink, true, columnWidth - 12);
    });
    ctx.fillStyle = '#cbb17d';
    ctx.fillRect(28, 357, 444, 1);
    ctx.textAlign = 'left';
    text(card.stage || '锦鲤前程', 28, 378, 15, muted, false, 230);
    ctx.textAlign = 'right';
    text(`+${card.coins} 锦鲤币`, 472, 378, 18, ink, true, 210);
    ctx.restore();
}
